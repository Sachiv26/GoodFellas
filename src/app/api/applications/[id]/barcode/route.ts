/**
 * Accept a realtime-scanned licence disc barcode.
 *
 * The disc barcode is the only data source in this application (no OCR, no AI),
 * so this endpoint parses the raw scanned string, stores it as a BarcodeExtraction
 * against the application's disc document, persists the mapped fields, and
 * recalculates the price from those vehicle details.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/session';
import { apiError } from '@/lib/api/errors';
import { parseDiscBarcode } from '@/lib/extraction/barcode-parser';
import { extractLicenceDiscFields } from '@/lib/extraction/disc-extractor';
import { fieldsToJson } from '@/lib/extraction';
import { recalculateApplicationPrice, } from '@/server/services/pricing-service';
import { refreshApplicationStatus } from '@/server/services/processing-service';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';
import { DOCUMENT_TYPE_CODES } from '@/lib/extraction';

const bodySchema = z.object({
  rawValue: z.string().trim().min(4).max(4096),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let session;
  try {
    session = await requireAuth();
  } catch {
    return apiError('UNAUTHORIZED', 'Authentication required', 401);
  }

  // IDOR defence: the application must belong to the caller.
  const application = await prisma.application.findFirst({
    where: { id: params.id, userId: session.sub },
    select: { id: true, productId: true },
  });
  if (!application) return apiError('NOT_FOUND', 'Application not found', 404);

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return apiError('VALIDATION_ERROR', 'A barcode value is required', 400);
  }

  const parsed = parseDiscBarcode(parsedBody.data.rawValue);
  const fieldCount = Object.values(parsed.fields).filter(Boolean).length;
  if (fieldCount === 0) {
    return apiError(
      'BARCODE_NOT_RECOGNISED',
      'That barcode is not a readable licence disc. Please scan it again.',
      422
    );
  }

  // Attach to the application's licence disc document. One may not exist yet
  // (the customer may scan before uploading a photo), so create it if needed.
  const documentType = await prisma.documentType.findUnique({
    where: { code: DOCUMENT_TYPE_CODES.VEHICLE_LICENCE_DISC },
    select: { id: true },
  });
  if (!documentType) {
    return apiError('CONFIGURATION_ERROR', 'Licence disc document type is not configured', 500);
  }

  const existing = await prisma.document.findFirst({
    where: {
      applicationId: application.id,
      documentTypeId: documentType.id,
      status: { not: 'REPLACED' },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const requirement = await prisma.productDocumentRequirement.findFirst({
    where: { productId: application.productId, documentTypeId: documentType.id },
    select: { id: true },
  });

  const document =
    existing ??
    (await prisma.document.create({
      data: {
        applicationId: application.id,
        requirementId: requirement?.id ?? null,
        documentTypeId: documentType.id,
        // A scanned barcode has no stored image bytes. The key stays unique and
        // valid so the row satisfies the NOT NULL storage-key contract; nothing
        // ever reads it because a scan replaces the whole field set.
        storageKey: `applications/${application.id}/documents/barcode-${Date.now()}.json`,
        originalFileName: 'licence-disc-barcode-scan.json',
        mimeType: 'application/json',
        fileSize: parsedBody.data.rawValue.length,
        checksum: '',
        uploadedById: session.sub,
        status: 'UPLOADED',
      },
    }));

  await prisma.barcodeExtraction.create({
    data: {
      documentId: document.id,
      symbology: 'SCAN',
      rawValue: parsedBody.data.rawValue,
      decodedDataJson: JSON.stringify(parsed),
      confidence: 0.95,
    },
  });

  // Persist the mapped fields so pricing, the admin screen and the audit trail
  // read them from one place, exactly as the upload pipeline does.
  const fields = extractLicenceDiscFields({
    barcodeFields: parsed.fields,
    barcodeConfidence: 0.95,
  });
  const scored = fields.filter((f) => f.value !== null && f.confidence !== null);
  await prisma.documentExtraction.create({
    data: {
      documentId: document.id,
      extractionVersion: 'barcode-v1',
      status: 'COMPLETED',
      rawText: null,
      extractedJson: JSON.stringify(fieldsToJson(fields)),
      confidence: scored.length
        ? scored.reduce((sum, f) => sum + (f.confidence ?? 0), 0) / scored.length
        : null,
      fieldExtractions: {
        create: fields.map((f) => ({
          fieldName: f.fieldName,
          value: f.value,
          normalizedValue: f.normalizedValue,
          confidence: f.confidence,
          source: f.source,
          validationStatus: f.validationStatus,
          validationNotes: f.validationNotes
            ? JSON.stringify(f.validationNotes)
            : undefined,
        })),
      },
    },
  });

  await prisma.document.update({ where: { id: document.id }, data: { status: 'PROCESSED' } });

  await audit.log({
    action: AUDIT_ACTIONS.BARCODE_PROCESSED,
    entity: 'Barcode',
    entityId: document.id,
    actorId: session.sub,
    metaData: { applicationId: application.id, documentId: document.id, source: 'realtime-scan', fieldCount },
  });

  await recalculateApplicationPrice({
    applicationId: application.id,
    actorId: session.sub,
    updateStatus: false,
  }).catch(() => void 0);
  await refreshApplicationStatus(application.id, session.sub).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    documentId: document.id,
    fieldCount,
    warnings: parsed.warnings,
  });
}
