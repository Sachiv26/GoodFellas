/**
 * Application service: product catalogue + customer application lifecycle.
 *
 * Customer DTOs are produced here (never raw Prisma models) so that OCR
 * output, confidence scores, storage keys, admin notes and generated PDFs
 * can never leak through customer-facing responses.
 */
import { db } from '@/lib/db';
import type { CreateApplicationInput } from '@/lib/validation';
import type {
  CustomerApplicationDetailDto,
  CustomerApplicationListItemDto,
  CustomerDocumentDto,
  CustomerDocumentRequirementDto,
  CustomerProductDto,
} from '@/types/dto';

const PRODUCT_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  version: true,
} as const;

export async function listProducts(): Promise<CustomerProductDto[]> {
  const products = await db.product.findMany({
    where: { active: true },
    select: PRODUCT_LIST_SELECT,
    orderBy: { name: 'asc' },
  });
  return products;
}

export async function getProductBySlug(slug: string): Promise<CustomerProductDto | null> {
  return db.product.findUnique({ where: { slug }, select: PRODUCT_LIST_SELECT });
}

export async function listProductRequirements(productId: string): Promise<
  CustomerDocumentRequirementDto[]
> {
  const rows = await db.productDocumentRequirement.findMany({
    where: { productId, active: true },
    orderBy: { sortOrder: 'asc' },
    include: { documentType: { select: { code: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    documentTypeId: r.documentTypeId,
    code: r.documentType.code,
    displayName: r.displayName,
    description: r.description,
    required: r.required,
    sortOrder: r.sortOrder,
  }));
}

function generateApplicationNumber(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString().slice(-2);
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `VL${y}${m}${d}-${rand}`;
}

export async function createApplication(
  userId: string,
  input: CreateApplicationInput
): Promise<CustomerApplicationListItemDto> {
  const product = await db.product.findUnique({ where: { slug: input.productSlug } });
  if (!product || !product.active) throw new Error('PRODUCT_NOT_FOUND');

  const application = await db.application.create({
    data: {
      applicationNumber: generateApplicationNumber(),
      userId,
      productId: product.id,
      status: 'DOCUMENTS_REQUIRED',
      paymentStatus: 'PENDING',
      ownerType: input.ownerType,
      vehicleClass: input.vehicleClass,
      currentExpiryDate: input.currentExpiryDate ? new Date(input.currentExpiryDate) : null,
    },
    include: { product: { select: PRODUCT_LIST_SELECT } },
  });

  await db.applicationStatusHistory.create({
    data: {
      applicationId: application.id,
      oldStatus: null,
      newStatus: 'DOCUMENTS_REQUIRED',
      changedById: userId,
      reason: 'Application created',
    },
  });

  return toListItem(application);
}

function toListItem(row: {
  id: string;
  applicationNumber: string;
  status: CustomerApplicationListItemDto['status'];
  price: number | null;
  currency: string;
  paymentStatus: CustomerApplicationListItemDto['paymentStatus'];
  vehicleClass: CustomerApplicationListItemDto['vehicleClass'];
  createdAt: Date;
  updatedAt: Date;
  product: { name: string; slug: string };
}): CustomerApplicationListItemDto {
  return {
    id: row.id,
    applicationNumber: row.applicationNumber,
    productName: row.product.name,
    productSlug: row.product.slug,
    status: row.status,
    price: row.price,
    currency: row.currency,
    paymentStatus: row.paymentStatus,
    vehicleClass: row.vehicleClass,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ITEM_INCLUDE = { product: { select: PRODUCT_LIST_SELECT } } as const;

export async function listApplicationsForUser(
  userId: string
): Promise<CustomerApplicationListItemDto[]> {
  const rows = await db.application.findMany({
    where: { userId },
    include: ITEM_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toListItem);
}

/** Customer-owned application lookup — enforces ownership server-side (IDOR defence). */
export async function getOwnedApplication(applicationId: string, userId: string) {
  return db.application.findFirst({
    where: { id: applicationId, userId },
    include: {
      ...ITEM_INCLUDE,
      product: { select: { ...PRODUCT_LIST_SELECT, id: true } },
      documents: {
        include: { documentType: { select: { code: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

export async function getApplicationDetailForUser(
  applicationId: string,
  userId: string
): Promise<CustomerApplicationDetailDto | null> {
  const app = await getOwnedApplication(applicationId, userId);
  if (!app) return null;

  const requirements = await listProductRequirements(app.productId);

  const documents: CustomerDocumentDto[] = app.documents
    .filter((d) => d.status !== 'REPLACED')
    .map((d) => ({
      id: d.id,
      documentTypeId: d.documentTypeId,
      code: d.documentType.code,
      displayName: requirements.find((r) => r.documentTypeId === d.documentTypeId)?.displayName ?? d.documentType.code,
      status: d.status,
      originalFileName: d.originalFileName,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      uploadedAt: d.createdAt.toISOString(),
    }));

  return {
    id: app.id,
    applicationNumber: app.applicationNumber,
    productName: app.product.name,
    productSlug: app.product.slug,
    status: app.status,
    price: app.price,
    currency: app.currency,
    paymentStatus: app.paymentStatus,
    vehicleClass: app.vehicleClass,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    requirements,
    documents,
  };
}