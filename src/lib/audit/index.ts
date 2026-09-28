/**
 * Audit logging. NEVER place sensitive document contents (OCR text, ID numbers,
 * raw barcodes) into audit metadata — only identifiers and action context.
 */
import { prisma } from '@/lib/db';
import type { UserRole } from '@prisma/client';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: UserRole | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metaData?: Record<string, unknown>;
  ipAddress?: string | null;
}

export const AUDIT_ACTIONS = {
  // Auth — dotted lower-case names are the existing on-record vocabulary and
  // are kept stable so historical audit rows stay filterable.
  AUTH_LOGIN: 'auth.login',
  AUTH_REGISTER: 'auth.register',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  AUTH_PASSWORD_RESET_COMPLETED: 'auth.password_reset_completed',
  AUTH_EMAIL_VERIFIED: 'auth.email_verified',
  USER_REGISTERED: 'USER_REGISTERED',
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_LOGOUT: 'USER_LOGOUT',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  APPLICATION_CREATED: 'APPLICATION_CREATED',
  APPLICATION_STATUS_CHANGED: 'APPLICATION_STATUS_CHANGED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_REPLACED: 'DOCUMENT_REPLACED',
  DOCUMENT_ACCESSED: 'DOCUMENT_ACCESSED',
  DOCUMENT_DELETED: 'DOCUMENT_DELETED',
  OCR_PROCESSED: 'OCR_PROCESSED',
  BARCODE_PROCESSED: 'BARCODE_PROCESSED',
  EXTRACTION_COMPLETED: 'EXTRACTION_COMPLETED',
  MANUAL_CORRECTION: 'MANUAL_CORRECTION',
  CROSS_VALIDATION_RUN: 'CROSS_VALIDATION_RUN',
  PRICE_CALCULATED: 'PRICE_CALCULATED',
  PRICING_CONFIG_CHANGED: 'PRICING_CONFIG_CHANGED',
  PRODUCT_CONFIG_CHANGED: 'PRODUCT_CONFIG_CHANGED',
  PDF_GENERATED: 'PDF_GENERATED',
  PDF_ACCESSED: 'PDF_ACCESSED',
  PDF_MAPPING_CHANGED: 'PDF_MAPPING_CHANGED',
  ADMIN_ACTION: 'ADMIN_ACTION',
} as const;

async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        metaData: (entry.metaData ?? {}) as object,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (err) {
    // Audit failures must never break the main flow, but must be visible.
    console.error('[audit] failed to record:', entry.action, err instanceof Error ? err.message : err);
  }
}

/**
 * `audit(entry)` and `audit.log(entry)` are equivalent entry points so route
 * handlers can adopt either style.
 */
export const audit: ((entry: AuditEntry) => Promise<void>) & {
  log: (entry: AuditEntry) => Promise<void>;
} = Object.assign(writeAudit, { log: writeAudit });

