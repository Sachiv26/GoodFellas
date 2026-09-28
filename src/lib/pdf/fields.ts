/**
 * ALV(9)(2011/07) field registry.
 *
 * These keys are the stable identifiers used by PdfFieldMapping.pdfFieldName
 * rows (seeded + admin-editable). This file is pure data — it declares WHICH
 * fields exist and which form section they belong to. Where they sit on the
 * page (coordinates) lives in the database; how values are rendered onto the
 * page (population) is implemented separately.
 *
 * Hard constraints carried by this registry:
 * - Unknown values stay blank. Never fabricate.
 * - Signatures are never auto-populated (signature fields render only from a
 *   legitimately supplied signature image).
 * - Office-use fields are admin-only and never fed from customer documents.
 */
import type { PdfSection } from './types';

export interface PdfFieldDefinition {
  key: string;
  section: PdfSection;
  /** Admin-only fields are never populated from customer/extraction data. */
  adminOnly: boolean;
  /** Signature fields require an explicitly supplied signature image. */
  signature?: boolean;
  /** Logical data source path shown in the admin mapping UI, e.g. ID.idNumber. */
  defaultSourcePath?: string;
}

function def(
  key: string,
  section: PdfSection,
  extra: Partial<PdfFieldDefinition> = {}
): PdfFieldDefinition {
  return { key, section, adminOnly: false, ...extra };
}

export const PDF_FIELDS: readonly PdfFieldDefinition[] = [
  // ── Particulars of owner ───────────────────────────────────────────────
  def('OWNER_IDENTIFICATION_TYPE', 'OWNER', { defaultSourcePath: 'ID.documentType' }),
  def('OWNER_TRAFFIC_REGISTER_NUMBER', 'OWNER', {
    defaultSourcePath: 'OWNER.trafficRegisterNumber',
  }),
  def('ID_NUMBER', 'OWNER', { defaultSourcePath: 'ID.idNumber' }),
  def('COUNTRY_OF_ISSUE', 'OWNER', { defaultSourcePath: 'ID.countryOfIssue' }),
  def('SURNAME_ORGANISATION', 'OWNER', { defaultSourcePath: 'ID.surname' }),
  def('INITIALS', 'OWNER', { defaultSourcePath: 'ID.initials' }),
  def('FIRST_NAMES', 'OWNER', { defaultSourcePath: 'ID.firstNames' }),
  def('EMAIL', 'OWNER', { defaultSourcePath: 'CUSTOMER.email' }),
  def('HOME_PHONE_CODE', 'OWNER', { defaultSourcePath: 'POR.homePhoneCode' }),
  def('HOME_PHONE_NUMBER', 'OWNER', { defaultSourcePath: 'POR.homePhoneNumber' }),
  def('DAYTIME_PHONE_CODE', 'OWNER', { defaultSourcePath: 'POR.dayTimePhoneCode' }),
  def('DAYTIME_PHONE_NUMBER', 'OWNER', { defaultSourcePath: 'POR.dayTimePhoneNumber' }),
  def('FAX_CODE', 'OWNER', { defaultSourcePath: 'POR.faxCode' }),
  def('FAX_NUMBER', 'OWNER', { defaultSourcePath: 'POR.faxNumber' }),
  def('CELLPHONE', 'OWNER', { defaultSourcePath: 'CUSTOMER.mobileNumber' }),

  // ── Address ────────────────────────────────────────────────────────────
  def('POSTAL_ADDRESS_LINE1', 'ADDRESS', { defaultSourcePath: 'POR.addressLine1' }),
  def('POSTAL_ADDRESS_LINE2', 'ADDRESS', { defaultSourcePath: 'POR.addressLine2' }),
  def('POSTAL_SUBURB', 'ADDRESS', { defaultSourcePath: 'POR.suburb' }),
  def('POSTAL_CITY', 'ADDRESS', { defaultSourcePath: 'POR.city' }),
  def('POSTAL_CODE', 'ADDRESS', { defaultSourcePath: 'POR.postalCode' }),
  def('ADDRESS_NOTICES_ADDR', 'ADDRESS', { defaultSourcePath: 'POR.streetAddress' }),
  def('ADDRESS_NOTICES_LINE2', 'ADDRESS', { defaultSourcePath: 'POR.addressLine2' }),
  def('ADDRESS_NOTICES_SUBURB', 'ADDRESS', { defaultSourcePath: 'POR.suburb' }),
  def('ADDRESS_NOTICES_CITY', 'ADDRESS', { defaultSourcePath: 'POR.city' }),
  def('ADDRESS_NOTICES_CODE', 'ADDRESS', { defaultSourcePath: 'POR.postalCode' }),
  def('ADDRESS_NOTICES_MARK', 'ADDRESS', { defaultSourcePath: 'ADDRESS.noticeType' }),

  // ── Organisation proxy (page 1) ───────────────────────────────────────
  def('PROXY_IDENTIFICATION_TYPE', 'ORGANISATION_PROXY', {
    defaultSourcePath: 'ORG_PROXY.identificationType',
  }),
  def('PROXY_TRAFFIC_REGISTER_NUMBER', 'ORGANISATION_PROXY', {
    defaultSourcePath: 'ORG_PROXY.trafficRegisterNumber',
  }),
  def('PROXY_ID_NUMBER', 'ORGANISATION_PROXY', {
    defaultSourcePath: 'ORG_PROXY.identificationNumber',
  }),
  def('PROXY_COUNTRY', 'ORGANISATION_PROXY', { defaultSourcePath: 'ORG_PROXY.countryOfIssue' }),
  def('PROXY_SURNAME_AND_INITIALS', 'ORGANISATION_PROXY', {
    defaultSourcePath: 'ORG_PROXY.surnameAndInitials',
  }),


  // ── Organisation representative (page 2) ──────────────────────────────
  def('REP_IDENTIFICATION_TYPE', 'ORGANISATION_REPRESENTATIVE', {
    defaultSourcePath: 'ORG_REP.identificationType',
  }),
  def('REP_TRAFFIC_REGISTER_NUMBER', 'ORGANISATION_REPRESENTATIVE', {
    defaultSourcePath: 'ORG_REP.trafficRegisterNumber',
  }),
  def('REP_ID_NUMBER', 'ORGANISATION_REPRESENTATIVE', {
    defaultSourcePath: 'ORG_REP.identificationNumber',
  }),
  def('REP_COUNTRY', 'ORGANISATION_REPRESENTATIVE', {
    defaultSourcePath: 'ORG_REP.countryOfIssue',
  }),
  def('REP_SURNAME_AND_INITIALS', 'ORGANISATION_REPRESENTATIVE', {
    defaultSourcePath: 'ORG_REP.surnameAndInitials',
  }),

  // ── Identification of motor vehicle ───────────────────────────────────
  def('LICENCE_NUMBER', 'VEHICLE', { defaultSourcePath: 'LICENCE_DISC.licenceNumber' }),
  def('VEHICLE_REGISTER_NUMBER', 'VEHICLE', {
    defaultSourcePath: 'LICENCE_DISC.vehicleRegisterNumber',
  }),
  def('VIN_OR_CHASSIS', 'VEHICLE', { defaultSourcePath: 'LICENCE_DISC.vin' }),
  def('MAKE', 'VEHICLE', { defaultSourcePath: 'LICENCE_DISC.make' }),
  def('SERIES_NAME', 'VEHICLE', { defaultSourcePath: 'LICENCE_DISC.seriesName' }),
  def('ODOMETER', 'VEHICLE', { defaultSourcePath: 'LICENCE_DISC.odometer' }),
  def('NO_ODOMETER_MARK', 'VEHICLE', { defaultSourcePath: 'LICENCE_DISC.noOdometer' }),
  def('STEERING_WHEEL_POSITION', 'VEHICLE', {
    defaultSourcePath: 'LICENCE_DISC.steeringWheelPosition',
  }),

  // ── Declaration ────────────────────────────────────────────────────────
  def('DECLARATION_OWNER_MARK', 'DECLARATION', { defaultSourcePath: 'APPLICATION.ownerType' }),
  def('DECLARATION_PROXY_MARK', 'DECLARATION', { defaultSourcePath: 'APPLICATION.ownerType' }),
  def('DECLARATION_REP_MARK', 'DECLARATION', { defaultSourcePath: 'APPLICATION.ownerType' }),
  def('DECLARATION_SIGNATURE', 'DECLARATION', {
    signature: true,
    defaultSourcePath: 'SIGNATURE.image',
  }),
  def('DECLARATION_PLACE', 'DECLARATION', { defaultSourcePath: 'DECLARATION.place' }),
  def('DECLARATION_DATE_AGREEMENT', 'DECLARATION', {
    defaultSourcePath: 'DECLARATION.date',
  }),
  def('DECLARATION_DATE_YEAR', 'DECLARATION', { defaultSourcePath: 'DECLARATION.date' }),
  def('DECLARATION_DATE_MONTH', 'DECLARATION', { defaultSourcePath: 'DECLARATION.date' }),
  def('DECLARATION_DATE_DAY', 'DECLARATION', { defaultSourcePath: 'DECLARATION.date' }),

  // ── Office use only — admin-only, never from customer data ────────────
  def('OFFICE_DATE_OF_APPLICATION', 'OFFICE_USE', {
    adminOnly: true,
    defaultSourcePath: 'OFFICE.dateOfApplication',
  }),
  def('OFFICE_DATE_YEAR', 'OFFICE_USE', {
    adminOnly: true,
    defaultSourcePath: 'OFFICE.dateOfApplication',
  }),
  def('OFFICE_DATE_MONTH', 'OFFICE_USE', {
    adminOnly: true,
    defaultSourcePath: 'OFFICE.dateOfApplication',
  }),
  def('OFFICE_DATE_DAY', 'OFFICE_USE', {
    adminOnly: true,
    defaultSourcePath: 'OFFICE.dateOfApplication',
  }),
  def('OFFICE_COUNTER_OFFICIAL_NAME', 'OFFICE_USE', {
    adminOnly: true,
    defaultSourcePath: 'OFFICE.counterOfficialName',
  }),
  def('OFFICE_COUNTER_OFFICIAL_SIGNATURE', 'OFFICE_USE', {
    adminOnly: true,
    signature: true,
    defaultSourcePath: 'OFFICE.counterOfficialSignature',
  }),
  def('OFFICE_DATA_CAPTURING_NAME', 'OFFICE_USE', {
    adminOnly: true,
    defaultSourcePath: 'OFFICE.dataCapturingName',
  }),
  def('OFFICE_DATA_CAPTURING_SIGNATURE', 'OFFICE_USE', {
    adminOnly: true,
    signature: true,
    defaultSourcePath: 'OFFICE.dataCapturingSignature',
  }),
  def('OFFICE_DATA_CAPTURING_DATE_YEAR', 'OFFICE_USE', {
    adminOnly: true,
    defaultSourcePath: 'OFFICE.dataCapturingDate',
  }),
  def('OFFICE_DATA_CAPTURING_DATE_MONTH', 'OFFICE_USE', {
    adminOnly: true,
    defaultSourcePath: 'OFFICE.dataCapturingDate',
  }),
  def('OFFICE_DATA_CAPTURING_DATE_DAY', 'OFFICE_USE', {
    adminOnly: true,
    defaultSourcePath: 'OFFICE.dataCapturingDate',
  }),
  def('OFFICE_SERIAL_NUMBER', 'OFFICE_USE', {
    adminOnly: true,
    defaultSourcePath: 'OFFICE.serialNumber',
  }),
] as const;

export type PdfFieldKey = (typeof PDF_FIELDS)[number]['key'];

export const PDF_FIELD: Record<PdfFieldKey, PdfFieldKey> = Object.freeze(
  PDF_FIELDS.reduce(
    (acc, f) => {
      acc[f.key as PdfFieldKey] = f.key as PdfFieldKey;
      return acc;
    },
    {} as Record<PdfFieldKey, PdfFieldKey>
  )
);

const BY_KEY = new Map<string, PdfFieldDefinition>(PDF_FIELDS.map((f) => [f.key, f]));

export function getPdfFieldDefinition(key: string): PdfFieldDefinition | undefined {
  return BY_KEY.get(key);
}

export function listPdfFieldsBySection(section: PdfSection): PdfFieldDefinition[] {
  return PDF_FIELDS.filter((f) => f.section === section);
}