import { prisma } from '@/lib/db';
import { appConfig } from '@/lib/config';
import { getOcrProvider, type OcrProvider } from '@/lib/ocr';
import { getBarcodeProvider } from '@/lib/barcode';
import { preprocessForOcr, extractRawPixels } from '@/lib/ocr/preprocess';
import { rasterizePdfPage } from '@/lib/ocr/pdf-raster';
import { parsePdfText } from '@/lib/ocr/pdf-parse';
import { parseDiscBarcode } from '@/lib/extraction/barcode-parser';
import { runExtraction, runCrossDocumentValidation, fieldsToJson, buildCvInput, DOCUMENT_TYPE_CODES } from '@/lib/extraction';
import { getStorage } from '@/lib/storage';
import { recalculateApplicationPrice } from './pricing-service';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';
import type { ProcessingJob } from '@prisma/client';
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
    latestExtraction: { status: string; fieldCount: number } | null;
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
 * to DOCUMENT_REVIEW/COMPLETED as processing and extraction report in.
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
  const allExtracted = required.every((id) => {
    const document = byType.get(id);
    return (
      document?.status === 'PROCESSED' &&
      document.latestExtraction?.status === 'COMPLETED' &&
      document.latestExtraction.fieldCount > 0
    );
  });
  const needsReview = required.some((id) =>
    ['NEEDS_REVIEW', 'REJECTED'].includes(byType.get(id)?.status ?? '')
  );

  if (needsReview) {
    return { next: 'DOCUMENT_REVIEW', reason: 'A required document needs review' };
  }
  if (allExtracted) {
    return {
      next: 'COMPLETED',
      reason: 'All required documents uploaded and successfully extracted',
    };
  }
  if (allProcessed) {
    return {
      next: 'DOCUMENTS_UPLOADED',
      reason: 'All required documents processed; extraction is incomplete',
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
 * request" rule intact in the sense that matters — the enqueue is still a cheap
 * DB write and the client response is not blocked on the whole batch — while
 * guaranteeing this document is actually processed. A real queue worker can
 * replace this call without any other change.
 */
export async function processDocumentNow(documentId: string): Promise<void> {
  await prisma.processingJob.updateMany({
    where: { documentId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  try {
    await runDocumentPipeline(documentId);
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
  const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { product: { include: { documentRequirements: { where: { active: true }, select: { documentTypeId: true, required: true } } } }, documents: { where: { status: { not: 'REPLACED' } }, select: { documentTypeId: true, status: true, extractions: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, fieldExtractions: { select: { id: true } } } } } } } });
  if (!application) return;
  const decision = decideApplicationStatus({
    requiredDocumentTypeIds: application.product.documentRequirements
      .filter((r) => r.required)
      .map((r) => r.documentTypeId),
    documents: application.documents.map((d) => ({
      documentTypeId: d.documentTypeId,
      status: d.status,
      latestExtraction: d.extractions[0]
        ? { status: d.extractions[0].status, fieldCount: d.extractions[0].fieldExtractions.length }
        : null,
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

/** Enqueue work after an upload Ã¢â‚¬â€ cheap DB writes only, never OCR. */
export async function enqueueDocumentProcessing(documentId: string): Promise<void> {
  const jobs: Array<{ type: ProcessingJob['type'] }> = [
    { type: 'PREPROCESS' },
    { type: 'BARCODE_DETECTION' },
    { type: 'OCR' },
    { type: 'FIELD_EXTRACTION' },
    { type: 'CROSS_DOCUMENT_VALIDATION' },
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
    where: { documentId, type: 'OCR', status: { in: ['PENDING', 'RUNNING'] } },
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

// Cross-validation input is built by the shared `buildCvInput` helper in
// `@/lib/extraction` so the pipeline and any other caller agree on the shape.

/**
 * Run a single document's full pipeline synchronously (used by tests, dev
 * fallback, and the admin "re-process" action). In production this runs in a
 * background worker, but the logic is identical.
 */
/**
 * Disc fields that change the licence fee when wrong.
 *
 * Read from a photo these are the values a vision model confuses (tare vs GVM
 * is the classic case), so they are always flagged for human confirmation when
 * they did not come from the barcode.
 */
const DISC_REVIEW_GATED_FIELDS = new Set([
  'tareWeight',
  'gvm',
  'registrationNumber',
  'licenceNumber',
  'vin',
  'chassisNumber',
  'expiryDate',
]);

/**
 * Fallback extraction for a licence disc whose barcode could not be decoded.
 *
 * Prefers the AI provider (which reads the printed face) and otherwise uses the
 * deterministic extractor over OCR text. Any priced field is marked
 * NEEDS_REVIEW so a misread weight cannot silently set the fee, and the field
 * `source` records that it came from the photo rather than the barcode.
 */
async function extractDiscFromPhoto(
  code: string,
  image: Buffer,
  ocrText: string | null,
  ocrWords: Array<{ text: string; confidence: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }>,
  barcodeFields: Record<string, string | null> | null
): Promise<{ version: string; fields: ReturnType<typeof runExtraction>['fields']; overallConfidence: number | null; rawText: string | null }> {
  let base: { version: string; fields: ReturnType<typeof runExtraction>['fields']; overallConfidence: number | null };
  let rawText: string | null = null;

  if (appConfig.ocr.engine === 'gemini' || appConfig.ocr.engine === 'cohere') {
    const provider = getOcrProvider() as OcrProvider & { extractFields: (buffer: Buffer, type: string, barcode?: Record<string, string | null> | null) => Promise<{ fields: ReturnType<typeof runExtraction>['fields']; rawText: string | null }> };
    const extracted = await provider.extractFields(image, code, barcodeFields);
    const scored = extracted.fields.filter((field) => field.confidence !== null);
    base = {
      version: appConfig.ocr.engine === 'cohere' ? 'cohere-v1' : 'gemini-v1',
      fields: extracted.fields,
      overallConfidence: scored.length
        ? scored.reduce((sum, field) => sum + (field.confidence ?? 0), 0) / scored.length
        : null,
    };
    rawText = extracted.rawText;
  } else {
    base = runExtraction(code, {
      rawText: ocrText ?? '',
      words: ocrWords,
      source: 'OCR',
      barcodeFields,
      barcodeConfidence: null,
    });
    rawText = ocrText ?? null;
  }

  // Gate the priced fields. A value already confirmed by the barcode is not
  // downgraded: if the barcode decoded this field, trust it.
  const fields = base.fields.map((field) => {
    const alreadyFromBarcode = field.source === 'BARCODE';
    if (alreadyFromBarcode || !field.value) return field;
    if (!DISC_REVIEW_GATED_FIELDS.has(field.fieldName)) return field;
    return {
      ...field,
      validationStatus: 'NEEDS_REVIEW' as const,
      validationNotes: [
        ...(field.validationNotes ?? []),
        'Read from the disc photo because the barcode could not be decoded — confirm this value',
      ],
    };
  });

  const scored = fields.filter((f) => f.value !== null && f.confidence !== null);
  return {
    version: base.version,
    fields,
    overallConfidence: scored.length
      ? scored.reduce((sum, f) => sum + (f.confidence ?? 0), 0) / scored.length
      : null,
    rawText,
  };
}

export async function runDocumentPipeline(documentId: string): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      documentType: true,
      application: { select: { id: true } },
    },
  });
  if (!document) return;

  await markDocumentProcessing(documentId);
  const storage = getStorage();
  const isPdf = document.mimeType === 'application/pdf';
  const original = await storage.get(document.storageKey);

  let ocrText: string | null = null;
  let ocrWords: Array<{
    text: string;
    confidence: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }> = [];
  let barcodeParsed: BarcodeFieldsResult | null = null;

  // A PDF scan has no pixel data of its own, so it is rasterised once here and
  // the page image is reused for both barcode decoding and (text-layer-less)
  // OCR. Without this, a licence disc uploaded as PDF could never be barcode
  // decoded, even though the barcode is printed on the page.
  const raster = isPdf ? await rasterizePdfPage(original, 0) : null;

  // Ã¢â€â‚¬Ã¢â€â‚¬ BARCODE Ã¢â€â‚¬Ã¢â€â‚¬
  const barcodePixels = isPdf
    ? raster
      ? await extractRawPixels(raster)
      : null
    : await extractRawPixels(original);
  if (barcodePixels) {
    let barcode = null;
    const provider = getBarcodeProvider();
    try {
      // Prefer the original bytes: a disc photographed at ~400px is too small
      // for ZXing to resolve PDF417 module widths, and the provider retries at
      // larger scales. The pre-downscaled raster is only a fallback.
      barcode = provider.decodeImage
        ? await provider.decodeImage(isPdf && raster ? raster : original)
        : await provider.decode(barcodePixels);
    } catch {
      // Barcode decoding is best-effort. A missing/ambiguous barcode must not
      // prevent Gemini from extracting visible document fields.
      barcode = null;
    }
    if (barcode) {
      const parsed = parseDiscBarcode(barcode.rawValue);
      await prisma.barcodeExtraction.create({
        data: {
          documentId: document.id,
          symbology: barcode.symbology,
          rawValue: barcode.rawValue,
          decodedDataJson: JSON.stringify(parsed),
          confidence: barcode.confidence,
        },
      });
      barcodeParsed = { fields: parsed.fields, confidence: barcode.confidence };
      await audit.log({
        action: AUDIT_ACTIONS.BARCODE_PROCESSED,
        entity: 'Barcode',
        entityId: document.id,
        metaData: { documentId: document.id, symbology: barcode.symbology },
      });
    }
  }

  // In Gemini mode, structured AI extraction is the only document read. Do not
  // make a second OCR request first; it adds latency, cost, and rate-limit
  // pressure and can fail independently of structured extraction.
  if (appConfig.ocr.engine !== 'gemini') {
    if (!isPdf) {
      const preprocessed = await preprocessForOcr(original, false);
      const provider = getOcrProvider();
      const result = await provider.recognize(preprocessed.buffer);
      ocrText = result.text;
      ocrWords = result.words;
    } else {
      ocrText = await parsePdfText(original);
      if (!ocrText && raster) {
        const preprocessed = await preprocessForOcr(raster, false);
        const provider = getOcrProvider();
        const result = await provider.recognize(preprocessed.buffer);
        ocrText = result.text || null;
        ocrWords = result.words;
      }
    }
  }

  const code = document.documentType.code;
  // A disc photo is usable even when the OCR text layer is empty: the AI
  // providers read the image itself, and the disc fallback below must be
  // reachable. Only bail out early for the local (non-AI) engine, which
  // genuinely has no text to work with. The previous guard only exempted
  // `gemini`, so with `cohere` configured the pipeline exited before ever
  // reaching the disc fallback.
  const isAiEngine = appConfig.ocr.engine === 'gemini' || appConfig.ocr.engine === 'cohere';
  if (!isAiEngine && !ocrText && ocrWords.length === 0) {
    await markDocumentNeedsReview(documentId, 'OCR produced no output');
    return;
  }
  const barcodeFields = barcodeParsed ?? (await getLatestBarcodeFields(documentId));
  // `rawText` is set by the photo fallback, so the local type must allow it.
  let run: { version: string; fields: ReturnType<typeof runExtraction>['fields']; overallConfidence: number | null; rawText?: string | null };
  let rawExtractionText: string | null = null;
  // ── LICENCE DISC: barcode first, photo only as a flagged fallback ───────
  // The disc barcode is machine-readable and authoritative for exactly the
  // fields that drive money (tare, GVM, registration, expiry). A vision model
  // reading the printed face is a correctness risk: on a real disc the AI read
  // GVM 1890kg as the tare, which silently moved the customer into a heavier
  // (and more expensive) weight bracket.
  //
  // So: barcode when it decodes (source BARCODE, trusted). If the barcode
  // cannot be read, fall back to reading the photo so the application can
  // still progress — but every money-affecting field it produces is marked
  // NEEDS_REVIEW so an admin confirms the weight before the fee is relied on.
  // The document also goes to DOCUMENT_REVIEW via the field status.
  const isDisc = code === DOCUMENT_TYPE_CODES.VEHICLE_LICENCE_DISC;
  const decodedCount = barcodeFields
    ? Object.values(barcodeFields.fields).filter(Boolean).length
    : 0;
  if (isDisc && decodedCount > 0) {
    run = runExtraction(code, {
      // No OCR text is supplied: the disc is extracted from the barcode alone.
      // Feeding the printed text back in let OCR values through mislabelled as
      // BARCODE (e.g. a GVM of "18901055" built by concatenating printed
      // figures), which is exactly the guessing this path must not do.
      rawText: '',
      words: [],
      source: 'BARCODE',
      barcodeFields: barcodeFields!.fields,
      barcodeConfidence: barcodeFields!.confidence,
    });
    rawExtractionText = null;
  } else if (isDisc) {
    // Barcode unreadable — read the photo instead, but gate the priced fields.
    run = await extractDiscFromPhoto(code, isPdf && raster ? raster : original, ocrText, ocrWords, barcodeFields?.fields ?? null);
    rawExtractionText = run.rawText ?? null;
  } else if (isAiEngine) {
    const provider = getOcrProvider() as OcrProvider & { extractFields: (buffer: Buffer, type: string, barcode?: Record<string, string | null> | null) => Promise<{ fields: ReturnType<typeof runExtraction>['fields']; rawText: string | null }> };
    const extracted = await provider.extractFields(isPdf && raster ? raster : original, code, barcodeFields?.fields ?? null);
    const scored = extracted.fields.filter((field) => field.confidence !== null);
    run = { version: appConfig.ocr.engine === 'cohere' ? 'cohere-v1' : 'gemini-v1', fields: extracted.fields, overallConfidence: scored.length ? scored.reduce((sum, field) => sum + (field.confidence ?? 0), 0) / scored.length : null };
    rawExtractionText = extracted.rawText;
  } else {
    run = runExtraction(code, { rawText: ocrText ?? '', words: ocrWords, source: 'OCR', barcodeFields: barcodeFields?.fields ?? null, barcodeConfidence: barcodeFields?.confidence ?? null });
    rawExtractionText = ocrText ?? null;
  }
  await prisma.documentExtraction.create({
    data: { documentId: document.id, extractionVersion: run.version, status: 'COMPLETED', rawText: rawExtractionText, extractedJson: JSON.stringify(fieldsToJson(run.fields)), confidence: run.overallConfidence, fieldExtractions: { create: run.fields.map((f) => ({ fieldName: f.fieldName, value: f.value, normalizedValue: f.normalizedValue, confidence: f.confidence, source: f.source, boundingBox: f.boundingBox ? (f.boundingBox as any) : undefined, validationStatus: f.validationStatus, validationNotes: f.validationNotes ? JSON.stringify(f.validationNotes) : undefined })) } },
    include: { fieldExtractions: true },
  });
  await audit.log({
    action: AUDIT_ACTIONS.EXTRACTION_COMPLETED,
    entity: 'Extraction',
    entityId: document.id,
    metaData: { documentId: document.id, fieldCount: run.fields.length },
  });
  await markDocumentProcessed(documentId);

  // Ã¢â€â‚¬Ã¢â€â‚¬ CROSS-DOCUMENT VALIDATION Ã¢â€â‚¬Ã¢â€â‚¬
  const allDocs = await prisma.document.findMany({
    where: {
      applicationId: document.application.id,
      status: { not: 'REPLACED' },
    },
    include: {
      documentType: true,
      extractions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { fieldExtractions: true },
      },
    },
  });
  const cvResults = runCrossDocumentValidation(
    buildCvInput(
      allDocs.map((doc) => ({ documentType: doc.documentType, extractions: doc.extractions }))
    )
  );

  for (const result of cvResults) {
    await prisma.crossDocumentValidation.upsert({
      where: {
        applicationId_ruleKey: {
          applicationId: document.application.id,
          ruleKey: result.ruleKey,
        },
      },
      update: { status: result.status, detailsJson: result.detailsJson as any },
      create: {
        applicationId: document.application.id,
        ruleKey: result.ruleKey,
        status: result.status,
        detailsJson: result.detailsJson as any,
      },
    });
  }
  await audit.log({
    action: AUDIT_ACTIONS.CROSS_VALIDATION_RUN,
    entity: 'CrossValidation',
    entityId: document.application.id,
    metaData: { ruleCount: cvResults.length },
  });

  // Ã¢â€â‚¬Ã¢â€â‚¬ PRICE Ã¢â€â‚¬Ã¢â€â‚¬
  await recalculateApplicationPrice({
    applicationId: document.application.id,
    actorId: document.uploadedById ?? 'system',
    updateStatus: false,
  }).catch(() => void 0);
  await refreshApplicationStatus(document.application.id, document.uploadedById ?? 'system');

}

/**
 * Run pending jobs (background worker entry point).
 *
 * `enqueueDocumentProcessing` writes one row per pipeline stage, but
 * `runDocumentPipeline` executes every stage in a single pass. The job rows are
 * therefore a LEDGER of that pass, not six independent units of work: without
 * grouping, one upload would pay for six full passes (six OCR runs, six
 * extraction rows, six price calculations).
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
        // The document's pass already ran in this batch Ã¢â‚¬â€ collapse the
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
