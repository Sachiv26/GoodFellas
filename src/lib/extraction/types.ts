/**
 * Generic extraction types shared across document processors.
 * Every field carries: value, normalizedValue, confidence, source,
 * validationStatus. NO FABRICATION: if a value cannot be determined it is
 * left null with validationStatus NEEDS_REVIEW.
 */
import type { ExtractionSource, FieldValidationStatus } from '@prisma/client';

export interface CrossValidationInput {
  id?: Record<string, string | null | undefined> | null;
  proofOfResidence?: Record<string, string | null | undefined> | null;
  licenceDisc?: Record<string, string | null | undefined> | null;
  application?: { currentExpiryDate?: Date | string | null } | null;
}

export interface ExtractedField {
  fieldName: string;
  value: string | null;
  normalizedValue: string | null;
  confidence: number | null;
  source: ExtractionSource;
  boundingBox?: { x0: number; y0: number; x1: number; y1: number } | null;
  validationStatus: FieldValidationStatus;
  validationNotes?: string[];
}

export const EXTRACTION_VERSION = 'v1';

export const ID_FIELDS = [
  'idNumber',
  'surname',
  'firstNames',
  'initials',
  'dateOfBirth',
  'gender',
  'citizenship',
  'documentType',
] as const;

export const POR_FIELDS = [
  'name',
  'surname',
  'idNumber',
  'addressLine1',
  'addressLine2',
  'suburb',
  'city',
  'province',
  'postalCode',
  'documentDate',
  'issuer',
  'accountNumber',
  'referenceNumber',
] as const;

export const DISC_FIELDS = [
  'registrationNumber',
  'licenceNumber',
  'vehicleRegisterNumber',
  'ownerName',
  'ownerIdNumber',
  'vin',
  'chassisNumber',
  'engineNumber',
  'make',
  'model',
  'seriesName',
  'vehicleType',
  'tareWeight',
  'gvm',
  'issueDate',
  'expiryDate',
  'discNumber',
  'odometer',
] as const;

export type IdFieldName = (typeof ID_FIELDS)[number];
export type PorFieldName = (typeof POR_FIELDS)[number];
export type DiscFieldName = (typeof DISC_FIELDS)[number];
