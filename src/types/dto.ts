import type { ApplicationStatus, DocumentStatus, PaymentStatus, UserRole, VehicleClass } from '@prisma/client';

/**
 * Customer-facing DTOs.
 *
 * Security rule: customer APIs must NEVER expose raw OCR text, confidence
 * scores, bounding boxes, admin notes, internal pricing rules, PDF storage
 * keys, generated admin PDFs or internal audit data. These types are the
 * ONLY shape customer endpoints may serialise (no raw Prisma models).
 */

export interface UserDto {
  id: string;
  firstName: string;
  surname: string;
  email: string;
  mobileNumber: string;
  role: UserRole;
  emailVerified: boolean;
}

export function toUserDto(user: {
  id: string;
  firstName: string;
  surname: string;
  email: string;
  mobileNumber: string;
  role: UserRole;
  emailVerifiedAt: Date | null;
}): UserDto {
  return {
    id: user.id,
    firstName: user.firstName,
    surname: user.surname,
    email: user.email,
    mobileNumber: user.mobileNumber,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

export interface CustomerProductDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: number;
}

export interface CustomerDocumentRequirementDto {
  id: string;
  documentTypeId: string;
  code: string;
  displayName: string;
  description: string;
  required: boolean;
  sortOrder: number;
}

export interface CustomerDocumentDto {
  id: string;
  documentTypeId: string;
  code: string;
  displayName: string;
  status: DocumentStatus;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
}

export interface CustomerApplicationListItemDto {
  id: string;
  applicationNumber: string;
  productName: string;
  productSlug: string;
  status: ApplicationStatus;
  price: number | null;
  currency: string;
  paymentStatus: PaymentStatus;
  /** Drives which TARE licence-fee column is priced. */
  vehicleClass: VehicleClass;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerApplicationDetailDto extends CustomerApplicationListItemDto {
  requirements: CustomerDocumentRequirementDto[];
  documents: CustomerDocumentDto[];
  /** No PDF data of any kind is exposed to customers. */
}
