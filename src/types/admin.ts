import type { ApplicationStatus, PaymentStatus } from '@prisma/client';

export interface AdminApplicationListItemDto {
  id: string;
  applicationNumber: string;
  customerName: string;
  customerEmail: string;
  productName: string;
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  price: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminFieldExtractionDto {
  id: string;
  fieldName: string;
  /** Latest authoritative value: manual correction wins over extraction. */
  value: string | null;
  /** Raw machine-extracted value (admin review only — never sent to customers). */
  rawValue: string | null;
  confidence: number | null;
  source: string;
  validationStatus: string;
  corrected: boolean;
}

export interface AdminBarcodeExtractionDto {
  id: string;
  symbology: string;
  rawValue: string;
  confidence: number;
  decodedAt: string;
}

export interface AdminDocumentDto {
  id: string;
  documentTypeId: string;
  code: string;
  displayName: string;
  status: string;
  originalFileName: string;
  mimeType: string;
  fileSize: string;
  createdAt: string;
  extractions: Array<{
    id: string;
    status: string;
    rawText: string | null;
    confidence: number | null;
    fields: AdminFieldExtractionDto[];
  }>;
  barcodes: AdminBarcodeExtractionDto[];
}

export interface AdminPricingBreakdownDto {
  id: string;
  version: number;
  currency: string;
  total: number;
  breakdown: unknown;
  inputs: unknown;
  createdAt: string;
}

export interface AdminApplicationDetailDto extends AdminApplicationListItemDto {
  ownerType: string;
  documents: AdminDocumentDto[];
  priceCalculations: AdminPricingBreakdownDto[];
  manualCorrections: Array<{
    id: string;
    fieldName: string;
    oldValue: string | null;
    newValue: string | null;
    reason: string | null;
    adminId: string;
    createdAt: string;
  }>;
  crossValidations: Array<{
    id: string;
    ruleKey: string;
    status: string;
    details: unknown;
  }>;
  generatedDocuments: Array<{
    id: string;
    fileName: string;
    createdAt: string;
  }>;
  adminNotes: Array<{
    id: string;
    content: string;
    authorId: string;
    createdAt: string;
  }>;
  statusHistory: Array<{
    id: string;
    oldStatus: ApplicationStatus | null;
    newStatus: ApplicationStatus;
    reason: string | null;
    createdAt: string;
  }>;
}
