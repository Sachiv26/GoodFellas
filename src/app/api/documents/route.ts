/**
 * Document upload API.
 *
 * Security:
 * - Requires authentication (IDOR defence — documents scoped to caller's app).
 * - Validates file type and size against configurable allow-list.
 * - Stores originals in PRIVATE storage (never /public).
 * - Never returns storage keys or internal data beyond the customer DTO.
 * - Enqueues processing jobs asynchronously — OCR never runs in-request.
 *
 * Customer DTO: { id, documentTypeId, code, displayName, status,
 *   originalFileName, mimeType, fileSize, uploadedAt }
 */
import { NextResponse } from 'next/server';
import { getStorage, assertSafeStorageKey, documentStorageKey } from '@/lib/storage';
import { appConfig } from '@/lib/config';
import { apiError } from '@/lib/api/errors';
import { requireAuth } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { enqueueDocumentProcessing, reenqueueDocumentPipeline, processDocumentNow, refreshApplicationStatus } from '@/server/services/processing-service';
import { AUDIT_ACTIONS, audit } from '@/lib/audit';
import { createHash, randomUUID } from 'node:crypto';
import { detectFileSignature, signatureExtension, signatureMatchesMime } from '@/lib/upload/file-signature';
import type { DocumentStatus } from '@prisma/client';

const ALLOWED_MIME = new Set(appConfig.uploads.allowedMimeTypes);
const ALLOWED_EXT = new Set(appConfig.uploads.allowedExtensions.map((e) => e.toLowerCase()));

export async function POST(request: Request) {
  let session;
  try {
    session = await requireAuth();
  } catch {
    return apiError('UNAUTHORIZED', 'Authentication required', 401);
  }
  const url = new URL(request.url);
  const applicationId = url.searchParams.get('applicationId');
  const replaceId = url.searchParams.get('replaceDocumentId');
  if (!applicationId) return apiError('VALIDATION_ERROR', 'applicationId is required', 400);

  // IDOR defence: application must belong to the authenticated user.
  const application = await db.application.findFirst({
    where: { id: applicationId, userId: session.sub },
    select: { id: true, productId: true },
  });
  if (!application) return apiError('NOT_FOUND', 'Application not found', 404);

  const form = await request.formData().catch(() => null);
  if (!form) return apiError('VALIDATION_ERROR', 'Invalid form data', 400);
  const file = form.get('file') as File | null;
  if (!file || !(file instanceof File) || file.size === 0) {
    return apiError('VALIDATION_ERROR', 'No file provided', 400);
  }
  if (file.size > appConfig.uploads.maxBytes) {
    return apiError('FILE_TOO_LARGE', `File exceeds ${appConfig.uploads.maxBytes} bytes`, 413);
  }
  const ext = (`.${file.name.split('.').pop() ?? ''}`).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return apiError('UNSUPPORTED_FILE_TYPE', `File type ${ext} is not allowed`, 400);
  if (!ALLOWED_MIME.has(file.type)) return apiError('UNSUPPORTED_FILE_TYPE', `MIME ${file.type} not allowed`, 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  // The declared MIME type and extension are client-controlled; the bytes are
  // not. Reject anything whose content does not match the claimed format.
  if (!signatureMatchesMime(buffer, file.type)) {
    return apiError(
      'UNSUPPORTED_FILE_TYPE',
      'File contents do not match the declared file type',
      400
    );
  }
  const signature = detectFileSignature(buffer);
  const checksum = createHash('sha256').update(buffer).digest('hex');

  // Resolve document type.
  let documentTypeId = null;
  let typeCode = '';
  let typeName = '';
  const byId = form.get('documentTypeId')?.toString();
  if (byId) {
    const dt = await db.documentType.findUnique({ where: { id: byId }, select: { id: true, code: true, name: true } });
    if (dt) { documentTypeId = dt.id; typeCode = dt.code; typeName = dt.name; }
  }
  if (!documentTypeId) {
    const code = form.get('documentType')?.toString();
    if (code) {
      const dt = await db.documentType.findUnique({ where: { code }, select: { id: true, code: true, name: true } });
      if (dt) { documentTypeId = dt.id; typeCode = dt.code; typeName = dt.name; }
    }
  }
  if (!documentTypeId) return apiError('VALIDATION_ERROR', 'Valid document type is required', 400);

  const requirement = await db.productDocumentRequirement.findFirst({
    where: { productId: application.productId, documentTypeId },
    select: { id: true, displayName: true, description: true },
  });

  // Storage keys are always unique per upload, so a replaced document keeps
  // pointing at the exact bytes that were originally submitted (audit trail)
  // instead of silently inheriting the replacement file.
  const key = documentStorageKey(application.id, randomUUID(), signatureExtension(signature!));
  assertSafeStorageKey(key);

  // Replace flow: mark old as REPLACED, create new.
  if (replaceId) {
    const existing = await db.document.findFirst({ where: { id: replaceId, applicationId } });
    if (!existing) return apiError('NOT_FOUND', 'Document not found to replace', 404);

    await getStorage().put(key, buffer, file.type);
    const replaced = await createDocumentRow({
      applicationId,
      requirementId: requirement?.id ?? null,
      documentTypeId,
      key,
      fileName: file.name,
      mimeType: file.type,
      size: buffer.length,
      checksum,
      uploadedById: session.sub,
    });
    if (!replaced) return apiError('INTERNAL_ERROR', 'Could not store the document', 500);

    await db.document.updateMany({
      where: { id: existing.id },
      data: { status: 'REPLACED' as DocumentStatus },
    });
    await reenqueueDocumentPipeline(replaced.id);
    // Reflect the new document set immediately, then process the replacement.
    await refreshApplicationStatus(applicationId, session.sub).catch(() => undefined);
    await processDocumentNow(replaced.id);
    await audit.log({
      action: AUDIT_ACTIONS.DOCUMENT_REPLACED,
      entity: 'Document',
      entityId: replaced.id,
      actorId: session.sub,
      metaData: { applicationId, documentTypeId, replacedDocumentId: existing.id },
    });
    return NextResponse.json({ document: toDto(replaced, typeCode, typeName, requirement) }, { status: 201 });
  }

  // New upload.
  await getStorage().put(key, buffer, file.type);
  const document = await createDocumentRow({
    applicationId,
    requirementId: requirement?.id ?? null,
    documentTypeId,
    key,
    fileName: file.name,
    mimeType: file.type,
    size: buffer.length,
    checksum,
    uploadedById: session.sub,
  });
  if (!document) return apiError('INTERNAL_ERROR', 'Could not store the document', 500);

  await enqueueDocumentProcessing(document.id);
  // The status must reflect the upload immediately. OCR/extraction runs later
  // (see runPendingJobs) and will advance it further, but relying on that
  // background pass left the application stuck on DOCUMENTS_REQUIRED whenever
  // the worker had not yet drained the queue.
  await refreshApplicationStatus(applicationId, session.sub).catch(() => undefined);
  // Process the document before responding. Previously this was
  // `void runPendingJobs()`, a fire-and-forget promise that the runtime
  // discards when the request is finalised — leaving every job PENDING and the
  // document stuck at UPLOADED, which blocks payment. A real queue worker can
  // replace this single call.
  await processDocumentNow(document.id);
  await audit.log({
    action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
    entity: 'Document',
    entityId: document.id,
    actorId: session.sub,
    metaData: { applicationId, documentTypeId },
  });

  return NextResponse.json({ document: toDto(document, typeCode, typeName, requirement) }, { status: 201 });
}

/**
 * Persist the document row. If the database write fails the freshly written
 * object is removed again so private storage cannot accumulate orphaned files.
 */
async function createDocumentRow(input: {
  applicationId: string;
  requirementId: string | null;
  documentTypeId: string;
  key: string;
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
  uploadedById: string;
}) {
  try {
    return await db.document.create({
      data: {
        applicationId: input.applicationId,
        requirementId: input.requirementId,
        documentTypeId: input.documentTypeId,
        storageKey: input.key,
        originalFileName: input.fileName,
        mimeType: input.mimeType || 'application/octet-stream',
        fileSize: input.size,
        checksum: input.checksum,
        uploadedById: input.uploadedById,
        status: 'UPLOADED' as DocumentStatus,
      },
    });
  } catch {
    await getStorage()
      .delete(input.key)
      .catch(() => undefined);
    return null;
  }
}

function toDto(
  doc: { id: string; documentTypeId: string; status: string; originalFileName: string; mimeType: string; fileSize: number; createdAt: Date },
  code: string,
  name: string,
  req: { displayName: string; description: string } | null,
) {
  return {
    id: doc.id,
    documentTypeId: doc.documentTypeId,
    code,
    displayName: req?.displayName ?? name,
    description: req?.description ?? '',
    status: doc.status,
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    uploadedAt: doc.createdAt.toISOString(),
  };
}

