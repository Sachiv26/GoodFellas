import { prisma } from '@/lib/db';
import { getBarcodeProvider } from '@/lib/barcode';
import { extractRawPixels } from '@/lib/ocr/preprocess';
import { rasterizePdfPage } from '@/lib/ocr/pdf-raster';
import { parseDiscBarcode } from '@/lib/extraction/barcode-parser';
import { extractLicenceDiscFields } from '@/lib/extraction/disc-extractor';
import { fieldsToJson } from '@/lib/extraction';
import { getStorage } from '@/lib/storage';
import { recalculateApplicationPrice } from './pricing-service';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';
import type { ProcessingJob } from '@prisma/client';

/** The one document type that carries machine-readable vehicle data. */
const DISC_DOCUMENT_CODE = 'VEHICLE_LICENCE_DISC';

/** Version tag for the barcode-derived extraction persisted below. */
const BARCODE_EXTRACTION_VERSION = 'barcode-v1';

/**
 * Document set inputs for the status decision.
 *
 * Mirrors what is read from the database so the decision itself is a pure,
 * unit-testable function rather than being buried in a Prisma transaction.
 */
export interface StatusDecisionInput {
  requiredDocumentTypeIds: string[];
  documents: Array<{
    documentTypeId: string;
    status: string;
    /** Number of barcode values decoded from this document, when it is a disc. */
    barcodeFieldCount?: number;
  }>;
}

export interface StatusDecision {
  next: 'DOCUMENTS_REQUIRED' | 'DOCUMENTS_UPLOADED' | 'DOCUMENT_REVIEW' | 'COMPLETED';
  reason: string;
}

/**
 * Derive the application status from the current document set.
 *
 * The decision is made from what has actually been uploaded, so the status
 * never depends on a background worker having run: an application with every
 * required document uploaded is DOCUMENTS_UPLOADED at once, and only advances
 * to DOCUMENT_REVIEW/COMPLETED as processing reports in.
 *
 * There is no OCR or AI extraction step, so "processed" is the terminal state
 * for a document. The licence disc is the exception: a disc that stored but
 * decoded no barcode values has produced no usable vehicle data, so the
 * application goes to DOCUMENT_REVIEW for manual attention rather than
 * completing with a price that cannot be calculated.
 *
 * Precedence: a document needing review wins over completion so a failed
 * document is never hidden behind an otherwise-complete set.
 */
export function decideApplicationStatus(input: StatusDecisionInput): StatusDecision {
  const { requiredDocumentTypeIds: required, documents } = input;

  // A product with no required documents cannot block a customer; treat the
  // set as satisfied so the application is not stuck on DOCUMENTS_REQUIRED.
  const byType = new Map(documents.map((d) => [d.documentTypeId, d]));
  const allUploaded = required.every((id) => byType.has(id));
  const allProcessed = required.every((id) => byType.get(id)?.status === 'PROCESSED');
  // A required disc only counts as usable once it has yielded vehicle data.
  const discDecoded = required.every((id) => {
    const document = byType.get(id);
    if (document?.status !== 'PROCESSED') return false;
    if (document.barcodeFieldCount === undefined) return true;
    return document.barcodeFieldCount > 0;
  });
  const needsReview = required.some((id) =>
    ['NEEDS_REVIEW', 'REJECTED'].includes(byType.get(id)?.status ?? '')
  );

  if (needsReview) {
    return { next: 'DOCUMENT_REVIEW', reason: 'A required document needs review' };
  }
  if (allProcessed && discDecoded) {
    return {
      next: 'COMPLETED',
      reason: 'All required documents processed and the licence disc barcode was decoded',
    };
  }
  if (allProcessed) {
    return {
      next: 'DOCUMENT_REVIEW',
      reason: 'The licence disc barcode could not be decoded, so vehicle details are missing',
    };
  }
  if (allUploaded) {
    return { next: 'DOCUMENTS_UPLOADED', reason: 'All required documents uploaded' };
  }
  return { next: 'DOCUMENTS_REQUIRED', reason: 'Required document uploaded' };
}

/**
 * Awaitably process a document's queued pipeline.
 *
 * `runPendingJobs` is fire-and-forget by design: the HTTP request that received
 * an upload returns, and on most Next.js deployments the runtime finalises the
 * request and the background promise is discarded before any job runs. The
 * queue then stays PENDING forever and the document never reaches PROCESSED,
 * which blocks payment (which requires every document PROCESSED).
 *
 * Awaiting the pipeline here keeps the "never run OCR inside the upload
 * request" rule intact in the sense that matters â€” the enqueue is still a cheap
 * DB write and the client response is not blocked on the whole batch â€” while
 * guaranteeing this document is actually processed. A real queue worker can
 * replace this call without any other change.
 */
export async function processDocumentNow(
  documentId: string,
  options: { skipReprice?: boolean } = {}
): Promise<void> {
  await prisma.processingJob.updateMany({
    where: { documentId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  try {
    await runDocumentPipeline(documentId, options);
    await prisma.processingJob.updateMany({
      where: { documentId, status: 'RUNNING' },
      data: { status: 'COMPLETED', finishedAt: new Date(), error: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.document.updateMany({
      where: { id: documentId, status: 'PROCESSING' },
      data: { status: 'NEEDS_REVIEW' },
    });
    await prisma.processingJob.updateMany({
      where: { documentId, status: 'RUNNING' },
      data: { status: 'PENDING', error: message, finishedAt: new Date() },
    });
  }
}

export async function refreshApplicationStatus(applicationId: string, actorId = 'system'): Promise<void> {
  const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { product: { include: { documentRequirements: { where: { active: true }, select: { documentTypeId: true, required: true } } } }, documents: { where: { status: { not: 'REPLACED' } }, select: { documentTypeId: true, status: true, barcodes: { orderBy: { decodedAt: 'desc' }, take: 1, select: { decodedDataJson: true } } } } } });
  if (!application) return;
  const decision = decideApplicationStatus({
    requiredDocumentTypeIds: application.product.documentRequirements
      .filter((r) => r.required)
      .map((r) => r.documentTypeId),
    documents: application.documents.map((d) => ({
      documentTypeId: d.documentTypeId,
      status: d.status,
      // Only the disc carries vehicle data; a doc with no barcode rows at all
      // must not be treated as a disc that failed to decode.
      barcodeFieldCount:
        d.barcodes[0] === undefined
          ? undefined
          : countBarcodeFields(d.barcodes[0].decodedDataJson),
    })),
  });
  if (application.status === decision.next) return;
  await prisma.$transaction([
    prisma.application.update({ where: { id: applicationId }, data: { status: decision.next as any, completedAt: decision.next === 'COMPLETED' ? new Date() : null, processedAt: decision.next === 'COMPLETED' ? new Date() : undefined } }),
    prisma.applicationStatusHistory.create({ data: { applicationId, oldStatus: application.status, newStatus: decision.next as any, changedById: actorId, reason: decision.reason } }),
  ]);
}






/**
 * Provider-isolated processing pipeline.
 *
 * The upload HTTP request never runs OCR: it stores the original, creates the
 * document record and enqueues jobs. Jobs are executed either by a background
 * worker (`runPendingJobs`) or by the dev fallback runner, always outside the
 * request that received the upload.
 */

/** Enqueue work after an upload ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â cheap DB writes only, never OCR. */
/** Enqueue work after an upload â€” cheap DB writes only, never decoding. */
export async function enqueueDocumentProcessing(documentId: string): Promise<void> {
  const jobs: Array<{ type: ProcessingJob['type'] }> = [
    { type: 'BARCODE_DETECTION' },
    { type: 'PRICE_CALCULATION' },
  ];
  await prisma.processingJob.createMany({
    data: jobs.map((j) => ({
      documentId,
      type: j.type,
      status: 'PENDING' as const,
      payload: {},
    })),
  });
}

/** Rebuild a document's full queue (used when a document is replaced). */
export async function reenqueueDocumentPipeline(documentId: string): Promise<void> {
  await prisma.processingJob.deleteMany({ where: { documentId, status: 'PENDING' } });
  await enqueueDocumentProcessing(documentId);
}

async function markDocumentProcessing(documentId: string): Promise<void> {
  await prisma.document.updateMany({
    where: { id: documentId, status: { in: ['UPLOADED', 'NEEDS_REVIEW'] } },
    data: { status: 'PROCESSING' },
  });
}

async function markDocumentProcessed(documentId: string): Promise<void> {
  await prisma.document.updateMany({
    where: { id: documentId, status: 'PROCESSING' },
    data: { status: 'PROCESSED' },
  });
}

/**
 * Flag a document for admin review. The reason is recorded on the document's
 * outstanding OCR job so an admin can see WHY it needs attention instead of
 * just that it does.
 */
async function markDocumentNeedsReview(documentId: string, reason: string): Promise<void> {
  await prisma.processingJob.updateMany({
    where: { documentId, type: 'BARCODE_DETECTION', status: { in: ['PENDING', 'RUNNING'] } },
    data: { error: reason, finishedAt: new Date() },
  });
  await prisma.document.updateMany({
    where: { id: documentId, status: { in: ['UPLOADED', 'PROCESSING'] } },
    data: { status: 'NEEDS_REVIEW' },
  });
}

interface BarcodeFieldsResult {
  fields: Record<string, string | null>;
  confidence: number | null;
}

async function getLatestBarcodeFields(documentId: string): Promise<BarcodeFieldsResult | null> {
  const barcode = await prisma.barcodeExtraction.findFirst({
    where: { documentId },
    orderBy: { decodedAt: 'desc' },
  });
  if (!barcode) return null;
  let fields: Record<string, string | null> = {};
  try {
    const parsed = JSON.parse(barcode.decodedDataJson as string);
    fields = (parsed?.fields as Record<string, string | null>) ?? {};
  } catch {
    fields = {};
  }
  return { fields, confidence: barcode.confidence };
}

/**
 * Count the non-empty values in a stored barcode payload.
 *
 * Used by the status decision to tell "the disc decoded" apart from "the disc
 * was stored but produced nothing usable". Unparseable JSON counts as zero.
 */
export function countBarcodeFields(decodedDataJson: unknown): number {
  try {
    const parsed =
      typeof decodedDataJson === 'string'
        ? JSON.parse(decodedDataJson)
        : decodedDataJson;
    const fields = (parsed as { fields?: Record<string, unknown> } | null)?.fields;
    if (!fields || typeof fields !== 'object') return 0;
    return Object.values(fields).filter(
      (v) => v !== null && v !== '' && v !== undefined
    ).length;
  } catch {
    return 0;
  }
}

/**
 * Turn a decoded disc barcode into field extractions.
 *
 * The barcode is the ONLY data source in this application: there is no OCR and
 * no AI extraction, so the disc's fields come exclusively from `parseDiscBarcode`
 * and every value carries `source: 'BARCODE'`. `DocumentExtraction` rows are
 * still written because the admin review screen, pricing resolution and the
 * audit trail all read them â€” they are a persistence format here, not a claim
 * that OCR or a model produced the values.
 */
function barcodeFieldsToExtractions(barcode: {
  fields: Record<string, string | null>;
  confidence: number;
}) {
  const fields = extractLicenceDiscFields({
    barcodeFields: barcode.fields,
    barcodeConfidence: barcode.confidence,
  });
  const scored = fields.filter((f) => f.value !== null && f.confidence !== null);
  return {
    version: BARCODE_EXTRACTION_VERSION,
    fields,
    overallConfidence: scored.length
      ? scored.reduce((sum, f) => sum + (f.confidence ?? 0), 0) / scored.length
      : null,
  };
}

export async function runDocumentPipeline(
  documentId: string,
  options: { skipReprice?: boolean } = {}
): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { documentType: true, application: { select: { id: true } } },
  });
  if (!document) return;

  await markDocumentProcessing(documentId);
  const storage = getStorage();
  const isPdf = document.mimeType === 'application/pdf';

  // The stored object can be gone even though its database row survives: local
  // disk is wiped on redeploy, an object may have been deleted out of band, and
  // a scan-created row has no image bytes at all. Reading it unguarded threw
  // ENOENT, which failed the whole job and left the document stuck in
  // PROCESSING. Flag it for an admin instead and stop.
  let original: Buffer;
  try {
    original = await storage.get(document.storageKey);
  } catch {
    await markDocumentNeedsReview(
      documentId,
      'The stored file for this document could not be read'
    );
    return;
  }

  // A PDF scan has no pixel data of its own, so it is rasterised once here and
  // the page image is used for barcode decoding. Without this, a licence disc
  // uploaded as PDF could never be decoded, even though the barcode is printed
  // on the page.
  const raster = isPdf ? await rasterizePdfPage(original, 0) : null;

  const reprice = async () => {
    // Pricing is driven ONLY by the licence disc barcode. The disc is the sole
    // source of vehicle data (registration, VIN, tare, GVM, expiry), so nothing
    // about the price can change when an ID or proof-of-residence is uploaded.
    // Repricing on those uploads performed a multi-second chain of database
    // round-trips to recompute an identical number, and blocked the customer
    // waiting on the upload.
    if (options.skipReprice) return;
    if (document!.documentType.code !== DISC_DOCUMENT_CODE) return;
    await recalculateApplicationPrice({
      applicationId: document!.application.id,
      actorId: document!.uploadedById ?? 'system',
      updateStatus: false,
    }).catch(() => void 0);
  };

  // Status is always re-derived: uploading a required document must move the
  // application on even when it does not affect the price.
  const refreshStatus = async () => {
    await refreshApplicationStatus(
      document!.application.id,
      document!.uploadedById ?? 'system'
    );
  };

  // Only the licence disc carries machine-readable data. Every other document
  // type is stored and marked processed without producing any fields, and
  // without triggering a reprice: it cannot change the price.
  if (document.documentType.code !== DISC_DOCUMENT_CODE) {
    await markDocumentProcessed(documentId);
    await refreshStatus();
    return;
  }

  // â”€â”€ BARCODE (the only data source) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const barcodePixels = isPdf
    ? raster
      ? await extractRawPixels(raster)
      : null
    : await extractRawPixels(original);

  let barcode: BarcodeFieldsResult | null = null;
  if (barcodePixels) {
    const provider = getBarcodeProvider();
    try {
      // Prefer the original bytes: a disc photographed at ~400px is too small
      // for ZXing to resolve PDF417 module widths, and the provider retries at
      // larger scales. The pre-downscaled raster is only a fallback.
      const decoded = provider.decodeImage
        ? await provider.decodeImage(isPdf && raster ? raster : original)
        : await provider.decode(barcodePixels);
      if (decoded) {
        const parsed = parseDiscBarcode(decoded.rawValue);
        await prisma.barcodeExtraction.create({
          data: {
            documentId: document.id,
            symbology: decoded.symbology,
            rawValue: decoded.rawValue,
            decodedDataJson: JSON.stringify(parsed),
            confidence: decoded.confidence,
          },
        });
        barcode = { fields: parsed.fields, confidence: decoded.confidence };
        await audit.log({
          action: AUDIT_ACTIONS.BARCODE_PROCESSED,
          entity: 'Barcode',
          entityId: document.id,
          metaData: {
            documentId: document.id,
            symbology: decoded.symbology,
            fieldCount: countBarcodeFields(parsed),
          },
        });
      }
    } catch {
      // Barcode decoding is best-effort. A missing or ambiguous barcode must not
      // crash the pipeline; the disc is flagged for review below instead.
      barcode = null;
    }
  }

  // There is NO photo fallback: with no OCR and no AI, an undecodable disc
  // simply carries no vehicle data. We persist whatever we did decode (possibly
  // nothing) so the admin screen can show exactly what was captured.
  const run = barcode
    ? barcodeFieldsToExtractions({
        fields: barcode.fields,
        confidence: barcode.confidence ?? 0.9,
      })
    : { version: BARCODE_EXTRACTION_VERSION, fields: [], overallConfidence: null };

  await prisma.documentExtraction.create({
    data: {
      documentId: document.id,
      extractionVersion: run.version,
      status: 'COMPLETED',
      rawText: null,
      extractedJson: JSON.stringify(fieldsToJson(run.fields)),
      confidence: run.overallConfidence,
      fieldExtractions: {
        create: run.fields.map((f) => ({
          fieldName: f.fieldName,
          value: f.value,
          normalizedValue: f.normalizedValue,
          confidence: f.confidence,
          source: f.source,
          boundingBox: f.boundingBox ? (f.boundingBox as never) : undefined,
          validationStatus: f.validationStatus,
          validationNotes: f.validationNotes
            ? JSON.stringify(f.validationNotes)
            : undefined,
        })),
      },
    },
  });
  await audit.log({
    action: AUDIT_ACTIONS.EXTRACTION_COMPLETED,
    entity: 'Extraction',
    entityId: document.id,
    metaData: {
      documentId: document.id,
      fieldCount: run.fields.length,
      source: 'barcode',
    },
  });

  if (countBarcodeFields(barcode?.fields ?? {}) === 0) {
    // Stored, but no vehicle data â€” the application must not price off it.
    await markDocumentNeedsReview(
      documentId,
      'The licence disc barcode could not be decoded'
    );
  } else {
    await markDocumentProcessed(documentId);
  }

  // Reprice only for the disc (guarded inside), then always refresh status.
  await reprice();
  await refreshStatus();
}


/**
 * Run pending jobs (background worker entry point).
 *
 * `enqueueDocumentProcessing` writes one row per pipeline stage, but
 * `runDocumentPipeline` executes every stage in a single pass. The job rows are
 * therefore a LEDGER of that pass, not independent units of work: without
 * grouping, one upload would pay for several full passes.
 */
export async function runPendingJobs(limit = 20): Promise<{ processed: number }> {
  const jobs = await prisma.processingJob.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  const outcome = new Map<string, 'ok' | 'failed'>();
  let processed = 0;

  for (const job of jobs) {
    const documentId = job.documentId;

    if (documentId) {
      const previous = outcome.get(documentId);
      if (previous === 'ok') {
        // The document's pass already ran in this batch ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â collapse the
        // remaining stage rows instead of re-running the pipeline.
        await prisma.processingJob.update({
          where: { id: job.id },
          data: {
            status: 'SKIPPED',
            attempts: { increment: 1 },
            finishedAt: new Date(),
            error: null,
          },
        });
        processed++;
        continue;
      }
      if (previous === 'failed') {
        // Leave the row PENDING so the next worker run retries the document.
        continue;
      }
    }

  try {
    await prisma.processingJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (documentId) await runDocumentPipeline(documentId);
    await prisma.processingJob.update({
      where: { id: job.id },
      data: { status: 'COMPLETED', finishedAt: new Date() },
    });
    if (documentId) outcome.set(documentId, 'ok');
    processed++;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (documentId) await prisma.document.updateMany({ where: { id: documentId, status: 'PROCESSING' }, data: { status: 'NEEDS_REVIEW' } });
    await prisma.processingJob.updateMany({ where: { documentId: documentId ?? undefined, status: 'RUNNING' }, data: { status: 'PENDING', error: message, finishedAt: new Date() } });
    await prisma.processingJob.update({ where: { id: job.id }, data: { status: job.attempts + 1 >= job.maxAttempts ? 'FAILED' : 'PENDING', finishedAt: new Date(), error: message } });
    if (documentId) outcome.set(documentId, 'failed');
  }
  }
  return { processed };
}
