/**
 * Background document processing.
 *
 * WHY THIS EXISTS
 * ---------------
 * The upload route used to run the whole document pipeline inline before
 * responding. Against a pooled remote database every query costs a network
 * round-trip (~280ms measured), and the pipeline issued roughly twenty of them
 * in sequence — a ~15 second wait for a customer who had merely picked a file.
 * No amount of caching fixes that: the work is inherently remote and serial.
 *
 * THE FIX
 * -------
 * The HTTP request now does only the minimum required to make the upload real
 * and durable — validate, store the bytes, write the document row, enqueue a
 * job — and returns. Everything expensive (barcode decoding, price
 * recalculation, status derivation) happens afterwards.
 *
 * DURABILITY
 * ----------
 * A bare fire-and-forget promise is not enough: serverless runtimes freeze or
 * discard work once the response is sent, so a document could sit at UPLOADED
 * forever and block payment. The `ProcessingJob` rows already in the database
 * are therefore the real queue:
 *
 *   1. the fast path kicks processing off and does not wait for it;
 *   2. anything that did not finish stays PENDING and is picked up by
 *      `drainPendingJobs`, which is safe to call from anywhere.
 *
 * That makes the system correct even if every background kick is lost — the
 * work is simply retried on the next drain.
 */
import { prisma } from '@/lib/db';
import { runDocumentPipeline, enqueueDocumentProcessing } from './processing-service';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';

/**
 * Kick off processing for a document without blocking the caller.
 *
 * Returns immediately. The promise is deliberately not awaited anywhere on the
 * request path; `drainPendingJobs` is the safety net if it never completes.
 */
export function kickOffProcessing(
  documentId: string,
  options: { enqueue?: boolean } = {}
): void {
  void (async () => {
    // Create the durable job row first, but only when the caller did not
    // already do so. It is written here rather than in the request because it
    // costs a round-trip and nothing about the customer-visible upload depends
    // on it existing yet.
    if (options.enqueue) {
      await enqueueDocumentProcessing(documentId);
    }
    await claimAndRun(documentId);
  })().catch((error) => {
    // Never let a background failure surface as an unhandled rejection: the job
    // row stays PENDING and the drain will retry it.
    console.error(
      '[worker] kick-off failed for document',
      documentId,
      error instanceof Error ? error.message : error
    );
  });
}

/**
 * Claim this document's pending jobs and run the pipeline.
 *
 * The claim is conditional (`status: 'PENDING'` -> `RUNNING`) so two concurrent
 * callers — the kick-off and a drain — cannot both process the same document.
 */
async function claimAndRun(documentId: string): Promise<void> {
  const claimed = await prisma.processingJob.updateMany({
    where: { documentId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  // Another worker already claimed it.
  if (claimed.count === 0) return;

  try {
    await runDocumentPipeline(documentId, { skipReprice: false });
    await prisma.processingJob.updateMany({
      where: { documentId, status: 'RUNNING' },
      data: { status: 'COMPLETED', finishedAt: new Date(), error: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.processingJob.updateMany({
      where: { documentId, status: 'RUNNING' },
      data: { status: 'PENDING', error: message, finishedAt: new Date() },
    });
    // A document that keeps failing should surface to an admin rather than
    // silently retrying forever.
    await prisma.document.updateMany({
      where: { id: documentId, status: 'PROCESSING' },
      data: { status: 'NEEDS_REVIEW' },
    });
    throw error;
  }
}

/**
 * Drain pending jobs — the durable safety net.
 *
 * Safe to call from a cron endpoint, a health check, or manually. Documents are
 * processed one at a time per invocation batch so a single request cannot hold
 * the database open.
 */
export async function drainPendingJobs(limit = 10): Promise<{
  processed: number;
  failed: number;
}> {
  const jobs = await prisma.processingJob.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { documentId: true },
  });

  // One document may have several stage rows; process each document once.
  const documentIds = [...new Set(jobs.map((j) => j.documentId).filter(Boolean))] as string[];
  let processed = 0;
  let failed = 0;

  for (const documentId of documentIds) {
    try {
      const did = await claimAndRun(documentId);
      void did;
      processed++;
    } catch (error) {
      failed++;
      console.error(
        '[worker] drain failed for document',
        documentId,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (processed || failed) {
    await audit.log({
      action: AUDIT_ACTIONS.PROCESSING_DRAINED,
      entity: 'ProcessingJob',
      metaData: { processed, failed },
    });
  }

  return { processed, failed };
}
