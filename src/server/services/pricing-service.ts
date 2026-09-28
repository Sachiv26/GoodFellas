/**
 * Pricing service — bridges persisted pricing configuration + resolved
 * application data into the pure pricing engine, then stores the calculation.
 *
 * Every persisted calculation keeps the configuration version it used, so an
 * admin editing pricing tomorrow cannot rewrite history.
 */
import type { ApplicationStatus, PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { calculatePrice } from '@/lib/pricing/engine';
import type { PricingCalculationResult, PricingInputs } from '@/lib/pricing/types';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';
import { resolveApplicationData, type ResolvedApplicationData } from './application-data-service';
import { loadPricingConfig } from '@/server/repositories/pricing-repository';

export interface PriceCalculationOutcome {
  calculationId: string;
  version: number;
  currency: string;
  total: number;
  result: PricingCalculationResult;
  warnings: string[];
}

/**
 * Build the engine inputs from the resolved application view. Values that
 * could not be determined are passed through as null so a rule can decide
 * (and the admin can see) that the input was unavailable.
 */
export function buildPricingInputs(data: ResolvedApplicationData): PricingInputs {
  const vehicle = data.vehicle;
  return {
    applicationDate: data.application.applicationDate,
    currentExpiryDate: data.application.currentExpiryDate,
    ownerType: data.application.ownerType,
    province: toNullable(data.sources['POR.province']?.value) ?? null,
    municipality: toNullable(data.sources['POR.city']?.value) ?? null,
    vehicleType: toNullable(vehicle.vehicleType),
    vehicleClass: data.application.vehicleClass,
    tareWeight: toNumeric(vehicle.tareWeight),
    gvm: toNumeric(vehicle.gvm),
    deliveryRequested: false,
    licenceExpiryDate: data.application.currentExpiryDate,
    registrationNumber: toNullable(vehicle.registrationNumber),
    provinceRaw: toNullable(data.sources['POR.province']?.value) ?? null,
    odometer: toNullable(vehicle.odometer),
  };
}

/** Calculate and persist a price for an application. Admin-only call sites. */
export async function recalculateApplicationPrice(options: {
  applicationId: string;
  actorId: string;
  deliveryRequested?: boolean;
  updateStatus?: boolean;
}): Promise<PriceCalculationOutcome> {
  const data = await resolveApplicationData(options.applicationId);
  const config = await loadPricingConfig({
    productId: data.application.productId,
    effectiveAt: new Date(),
  });

  const inputs = buildPricingInputs(data);
  if (options.deliveryRequested !== undefined) {
    inputs.deliveryRequested = options.deliveryRequested;
  }

  const result = calculatePrice(config, inputs);

  const calculation = await prisma.priceCalculation.create({
    data: {
      applicationId: options.applicationId,
      version: result.version,
      currency: result.currency,
      total: result.total,
      breakdown: {
        components: result.components,
        subtotal: result.subtotal,
        total: result.total,
        warnings: result.warnings,
      } as unknown as Prisma.InputJsonValue,
      inputs: result.inputs as unknown as Prisma.InputJsonValue,
      createdBy: options.actorId,
    },
  });

  // The denormalised price cache is ALWAYS written: it is derived data that
  // the dashboard and payment page read, and it must not depend on the caller
  // choosing to move the application into PRICE_CALCULATED. Previously the
  // whole update (including `price`) sat behind `updateStatus`, so the pipeline
  // pass — which passes `updateStatus: false` — stored a PriceCalculation with
  // a total but left `Application.price` null and payment permanently blocked.
  // Only the status transition is conditional; `refreshApplicationStatus`
  // remains the single source of truth for the status itself.
  await prisma.application.update({
    where: { id: options.applicationId },
    data: {
      price: result.total,
      currency: result.currency,
      pricingVersion: result.version,
      ...(options.updateStatus === false
        ? {}
        : { status: 'PRICE_CALCULATED' as ApplicationStatus }),
    },
  });

  await audit({
    actorId: options.actorId,
    action: AUDIT_ACTIONS.PRICE_CALCULATED,
    entity: 'Application',
    entityId: options.applicationId,
    metaData: {
      calculationId: calculation.id,
      pricingVersion: result.version,
      total: result.total,
      warningCount: result.warnings.length,
    },
  });

  return {
    calculationId: calculation.id,
    version: result.version,
    currency: result.currency,
    total: result.total,
    result,
    warnings: result.warnings,
  };
}

export async function getLatestPriceCalculation(applicationId: string) {
  return prisma.priceCalculation.findFirst({
    where: { applicationId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listPriceCalculations(applicationId: string) {
  return prisma.priceCalculation.findMany({
    where: { applicationId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export interface PaymentStatusInput {
  paymentStatus: PaymentStatus;
}

function toNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function toNumeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
