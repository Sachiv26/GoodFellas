
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { getStorage } from '../src/lib/storage';

const db = new PrismaClient();
const root = path.resolve(process.cwd(), 'prisma/seed-assets/vehiclelicenserenewalform.pdf');

const documents = [
  { code: 'SOUTH_AFRICAN_ID', name: 'South African ID', description: 'A clear image or PDF of the ownerâ€™s South African identity document.', sortOrder: 1 },
  { code: 'PROOF_OF_RESIDENCE', name: 'Proof of Residence', description: 'A recent proof of residence in the ownerâ€™s name.', sortOrder: 2 },
  { code: 'VEHICLE_LICENCE_DISC', name: 'Vehicle Licence Disc', description: 'A clear image or PDF of the current vehicle licence disc.', sortOrder: 3 },
];

const blockMappings = [
  ['owner_id_type_rsa_id', 'OWNER.identificationType', 'OWNER', 'CHECKBOX', 'RSA_ID'],
  ['owner_id_number', 'ID.idNumber', 'OWNER', 'TEXT', null],
  ['owner_surname', 'ID.surname', 'OWNER', 'TEXT', null],
  ['owner_initials', 'ID.initials', 'OWNER', 'TEXT', null],
  ['owner_first_names', 'ID.firstNames', 'OWNER', 'TEXT', null],
  ['owner_email', 'CUSTOMER.email', 'OWNER', 'TEXT', null],
  ['owner_cellphone', 'CUSTOMER.mobileNumber', 'OWNER', 'TEXT', null],
  ['owner_postal_address_line1', 'POR.addressLine1', 'ADDRESS', 'TEXT', null],
  ['owner_postal_address_line2', 'POR.addressLine2', 'ADDRESS', 'TEXT', null],
  ['owner_postal_suburb', 'POR.suburb', 'ADDRESS', 'TEXT', null],
  ['owner_postal_city', 'POR.city', 'ADDRESS', 'TEXT', null],
  ['owner_postal_code', 'POR.postalCode', 'ADDRESS', 'TEXT', null],
  ['owner_notices_address_postal', 'APPLICATION.noticesPostal', 'ADDRESS', 'CHECKBOX', 'true'],
  ['vehicle_licence_number', 'LICENCE_DISC.licenceNumber', 'VEHICLE', 'TEXT', null],
  ['vehicle_register_number', 'LICENCE_DISC.vehicleRegisterNumber', 'VEHICLE', 'TEXT', null],
  ['vehicle_chassis_vin', 'LICENCE_DISC.vin', 'VEHICLE', 'TEXT', null],
  ['vehicle_make', 'LICENCE_DISC.make', 'VEHICLE', 'TEXT', null],
  ['vehicle_series_name', 'LICENCE_DISC.seriesName', 'VEHICLE', 'TEXT', null],
  ['vehicle_odometer_reading', 'LICENCE_DISC.odometer', 'VEHICLE', 'TEXT', null],
  ['declarant_type_owner', 'APPLICATION.ownerType', 'DECLARATION', 'CHECKBOX', 'INDIVIDUAL'],
  ['declaration_date', 'APPLICATION.applicationDate', 'DECLARATION', 'TEXT', null],
] as const;

async function main() {
  const product = await db.product.upsert({
    where: { slug: 'vehicle-licence-renewal' },
    update: { name: 'Vehicle Licence Renewal', description: 'Renew a South African motor vehicle licence using secure document processing.', active: true, version: 1 },
    create: { name: 'Vehicle Licence Renewal', slug: 'vehicle-licence-renewal', description: 'Renew a South African motor vehicle licence using secure document processing.', active: true, version: 1, config: { pricing: { currency: 'ZAR', version: 1, editableSample: true } } },
  });
  const types = new Map<string, string>();
  for (const item of documents) {
    const type = await db.documentType.upsert({ where: { code: item.code }, update: { name: item.name, description: item.description, active: true }, create: { code: item.code, name: item.name, description: item.description, active: true } });
    types.set(item.code, type.id);
    await db.productDocumentRequirement.upsert({ where: { productId_documentTypeId: { productId: product.id, documentTypeId: type.id } }, update: { required: true, displayName: item.name, description: item.description, sortOrder: item.sortOrder, active: true }, create: { productId: product.id, documentTypeId: type.id, required: true, displayName: item.name, description: item.description, sortOrder: item.sortOrder, validationConfig: {}, extractionConfig: {}, active: true } });
  }


  const pdfBytes = await fs.readFile(root);
  const pdf = await PDFDocument.load(pdfBytes);
  const templateStorageKey = `templates/ALV9_2011_07/v1/vehiclelicenserenewalform.pdf`;
  // Upload through the storage abstraction rather than writing to disk: the
  // Vercel filesystem is read-only, so a direct writeFile would fail in
  // production and the template would never reach the blob store.
  await getStorage().put(templateStorageKey, Buffer.from(pdfBytes), 'application/pdf');
  const template = await db.pdfTemplate.upsert({ where: { code: 'ALV9_2011_07' }, update: { name: 'ALV(9)(2011/07) - fillable', storageKey: templateStorageKey, pageCount: pdf.getPageCount(), hasAcroForm: true, active: true, version: 2 }, create: { name: 'ALV(9)(2011/07) - fillable', code: 'ALV9_2011_07', description: 'Application for licensing of motor vehicle - supplied fillable form', storageKey: templateStorageKey, pageCount: pdf.getPageCount(), hasAcroForm: true, active: true, version: 2 } });
  const fields = pdf.getForm().getFields();
  const mappingDefinitions: Array<[string, string, string, 'TEXT' | 'CHECKBOX', string | null]> = [];
  for (const [prefix, sourcePath, section, layout, checkboxValue] of blockMappings) {
    const matching = fields.filter((field) => field.getName() === prefix || field.getName().startsWith(`${prefix}_`));
    for (const field of matching) {
      mappingDefinitions.push([field.getName(), sourcePath, section, layout, checkboxValue]);
    }
  }
  for (const [pdfFieldName, sourcePath, section, layout] of mappingDefinitions) {
    await db.pdfFieldMapping.upsert({ where: { templateId_pdfFieldName: { templateId: template.id, pdfFieldName } }, update: { sourcePath, section, layout, active: true, kind: layout === 'CHECKBOX' ? 'CHECKBOX' : 'TEXT' }, create: { templateId: template.id, sourcePath, section, pdfFieldName, layout, active: true, kind: layout === 'CHECKBOX' ? 'CHECKBOX' : 'TEXT' } });
  }
  const activePdfFields = mappingDefinitions.map(([pdfFieldName]) => pdfFieldName);
  await db.pdfFieldMapping.updateMany({ where: { templateId: template.id, active: true, pdfFieldName: { notIn: activePdfFields } }, data: { active: false } });
  // Fee lookup rows are now scoped per vehicle class using the shared
  // "SCOPE::key" convention. Remove the legacy unscoped rows so a stale
  // MOTOR_CAR fee can never be picked up as a fallback.
  await db.pricingLookupEntry.deleteMany({ where: { table: { code: 'TARE_LICENCE_FEES' } } });
  await db.pricingComponent.updateMany({ where: { productId: product.id, code: { in: ['SERVICE_FEE', 'TRANSACTION_FEE'] } }, data: { active: false } });

  const tareRows = [
    [250, 500, 396, 1332, 240, 300], [500, 750, 432, 1332, 240, 432], [750, 1000, 456, 1332, 240, 504], [1000, 1250, 528, 1332, 240, 600], [1250, 1500, 732, 1332, 240, 756], [1500, 1750, 852, 1332, 240, 912], [1750, 2000, 1104, 1332, 240, 1104], [2000, 2250, 1284, 1332, 252, 1320], [2250, 2500, 1536, 1332, 252, 1512], [2500, 2750, 1728, 1332, 252, 1764], [2750, 3000, 1956, 1332, 252, 1980], [3000, 3250, 2112, 1332, 252, 3780], [3250, 3500, 2484, 1332, 252, 4152], [3500, 3750, 2880, 1332, 252, 4608], [3750, 4000, 3216, 1332, 252, 5100], [4000, 4250, 3480, 1332, 348, 5412], [4250, 4500, 3780, 1332, 348, 6000], [4500, 4750, 4116, 1332, 348, 6444], [4750, 5000, 4416, 1332, 348, 6984], [5000, 5250, 6684, 11364, 348, 7608], [5250, 5500, 7392, 11364, 348, 8172], [5500, 5750, 8076, 11364, 348, 8760], [5750, 6000, 8928, 11364, 348, 9408], [6000, 6250, 9600, 11364, 348, 10092], [6250, 6500, 10272, 11364, 348, 10776], [6500, 6750, 11364, 11364, 348, 11412], [6750, 7000, 12060, 11364, 348, 12084], [7000, 7250, 12720, 11364, 348, 12744],
  ] as const;
  for (const [min, max, licenceFee, rigid, breakdown, tractor] of tareRows) await db.tareLicenceFee.upsert({ where: { vehicleType_minWeightKg_maxWeightKg: { vehicleType: 'MOTOR_CAR', minWeightKg: min, maxWeightKg: max } }, update: { licenceFee, rigidVehicleFee: rigid, breakdownVehicleFee: breakdown, tractorFee: tractor, trailerFee: tractor, active: true }, create: { vehicleType: 'MOTOR_CAR', minWeightKg: min, maxWeightKg: max, licenceFee, rigidVehicleFee: rigid, breakdownVehicleFee: breakdown, tractorFee: tractor, trailerFee: tractor } });

  // One lookup row per (vehicle class, weight bracket). The customer's choice on
  // the first page of the application is passed as the lookup scope, which is
  // what selects the fee column. Amounts come from the TareLicenceFee table.
  const feeTable = await db.pricingLookupTable.upsert({ where: { code: 'TARE_LICENCE_FEES' }, update: { name: 'TARE licence fees', active: true }, create: { code: 'TARE_LICENCE_FEES', name: 'TARE licence fees', description: 'Licence fees imported from TARE.txt, per vehicle class and tare weight', active: true } });
  for (const [min, max, licenceFee, rigid, breakdown, tractor] of tareRows) {
    const range = `${min}-${max}`;
    const fees: Array<[string, number]> = [
      ['MOTOR_CAR', licenceFee],
      // Business rule: rigid vehicles are charged the standard TARE rate for
      // the weight bracket, NOT the separate "Rigid vehicles*" column (which is
      // a flat R1 332,00 across every bracket in the published schedule).
      // Confirmed against the TARE schedule for the 1 000-1 250 kg bracket.
      // NOTE: this makes RIGID_VEHICLE price identically to MOTOR_CAR. If the
      // rigid column is meant to apply, restore `rigid` here.
      ['RIGID_VEHICLE', licenceFee],
      ['BREAKDOWN_VEHICLE', breakdown],
      ['TRACTOR', tractor],
      ['TRAILER', tractor],
    ];
    for (const [vehicleClass, amount] of fees) {
      const label = `${vehicleClass} ${min}kg - ${max}kg`;
      await db.pricingLookupEntry.upsert({ where: { tableId_key: { tableId: feeTable.id, key: `${vehicleClass}::${range}` } }, update: { label, minValue: min, maxValue: max, amount, active: true }, create: { tableId: feeTable.id, key: `${vehicleClass}::${range}`, label, minValue: min, maxValue: max, amount, active: true } });
    }
  }
  const licence = await db.pricingComponent.upsert({ where: { productId_code: { productId: product.id, code: 'LICENCE_FEE' } }, update: { name: 'Licence disc fee', active: true, version: 1 }, create: { productId: product.id, code: 'LICENCE_FEE', name: 'Licence disc fee', kind: 'BASE', label: 'Licence disc fee', active: true, version: 1 } });
  const tareRuleExpr = JSON.stringify({ code: 'TARE', when: { op: 'always' }, amount: { type: 'lookupRange', table: 'TARE_LICENCE_FEES', rangePath: 'vehicle.tareWeight', scopePath: 'vehicle.vehicleClass' } });
  await db.pricingRule.upsert({ where: { componentId_version: { componentId: licence.id, version: 1 } }, update: { name: 'TARE licence fee by tare weight and vehicle class', active: true, expr: tareRuleExpr, priority: 1 }, create: { componentId: licence.id, version: 1, name: 'TARE licence fee by tare weight and vehicle class', expr: tareRuleExpr, priority: 1 } });
  const adminFee = await db.pricingComponent.upsert({ where: { productId_code: { productId: product.id, code: 'ADMIN_FEE' } }, update: { name: 'Licence administration fee', active: true, version: 1 }, create: { productId: product.id, code: 'ADMIN_FEE', name: 'Licence administration fee', kind: 'SERVICE', label: 'Licence administration fee', active: true, version: 1 } });
  await db.pricingRule.upsert({ where: { componentId_version: { componentId: adminFee.id, version: 1 } }, update: { name: 'Configurable administration fee', active: true, expr: JSON.stringify({ code: 'DEFAULT', when: { op: 'always' }, amount: { type: 'fixed', amount: 72 } }), priority: 5 }, create: { componentId: adminFee.id, version: 1, name: 'Configurable administration fee', expr: JSON.stringify({ code: 'DEFAULT', when: { op: 'always' }, amount: { type: 'fixed', amount: 72 } }), priority: 5 } });
  const penalty = await db.pricingComponent.upsert({ where: { productId_code: { productId: product.id, code: 'PENALTY' } }, update: { name: 'Late licensing penalty', active: false, version: 1 }, create: { productId: product.id, code: 'PENALTY', name: 'Late licensing penalty', kind: 'PENALTY', label: 'Late licensing penalty', active: true, version: 1 } });
  await db.pricingRule.upsert({ where: { componentId_version: { componentId: penalty.id, version: 1 } }, update: { name: 'Penalty after 21 days', active: true, expr: JSON.stringify({ code: 'AFTER_21_DAYS', when: { op: 'daysBetween', path: 'applicationDate', compareTo: 'currentExpiryDate', value: 21, comparator: 'gt' }, amount: { type: 'fixed', amount: 72 } }), priority: 20 }, create: { componentId: penalty.id, version: 1, name: 'Penalty after 21 days', expr: JSON.stringify({ code: 'AFTER_21_DAYS', when: { op: 'daysBetween', path: 'applicationDate', compareTo: 'currentExpiryDate', value: 21, comparator: 'gt' }, amount: { type: 'fixed', amount: 72 } }), priority: 20 } });
  const arrears = await db.pricingComponent.upsert({ where: { productId_code: { productId: product.id, code: 'ARREARS' } }, update: { name: 'Monthly arrears', active: true, version: 1 }, create: { productId: product.id, code: 'ARREARS', name: 'Monthly arrears', kind: 'ARREARS', label: 'Monthly arrears', active: true, version: 1 } });
  await db.pricingRule.upsert({ where: { componentId_version: { componentId: arrears.id, version: 1 } }, update: { name: '10 percent monthly arrears after 21 days', active: true, expr: JSON.stringify({ code: 'MONTHLY_ARREARS', when: { op: 'daysBetween', path: 'applicationDate', compareTo: 'currentExpiryDate', value: 21, comparator: 'gt' }, amount: { type: 'percentageOfOverdueMonths', rate: 10 } }), priority: 30 }, create: { componentId: arrears.id, version: 1, name: '10 percent monthly arrears after 21 days', expr: JSON.stringify({ code: 'MONTHLY_ARREARS', when: { op: 'daysBetween', path: 'applicationDate', compareTo: 'currentExpiryDate', value: 21, comparator: 'gt' }, amount: { type: 'percentageOfOverdueMonths', rate: 10 } }), priority: 30 } });
  const vat = await db.pricingComponent.upsert({ where: { productId_code: { productId: product.id, code: 'VAT' } }, update: { name: 'VAT', active: true, version: 1 }, create: { productId: product.id, code: 'VAT', name: 'VAT', kind: 'SERVICE', label: 'VAT', active: true, version: 1 } });
  await db.pricingRule.upsert({ where: { componentId_version: { componentId: vat.id, version: 1 } }, update: { name: 'Configurable VAT', active: true, expr: JSON.stringify({ code: 'DEFAULT', when: { op: 'always' }, amount: { type: 'percentageOf', path: '__subtotal__', rate: 0 } }), priority: 100 }, create: { componentId: vat.id, version: 1, name: 'Configurable VAT', expr: JSON.stringify({ code: 'DEFAULT', when: { op: 'always' }, amount: { type: 'percentageOf', path: '__subtotal__', rate: 0 } }), priority: 100 } });

  const sampleRules: Array<{ code: string; name: string; kind: 'SERVICE' | 'DELIVERY' | 'TRANSACTION' | 'BASE' | 'PENALTY' | 'ARREARS' | 'DISCOUNT'; expr: { code: string; when: { op: 'always' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'exists' | 'missing' | 'and' | 'or' | 'not' | 'daysBetween'; [key: string]: unknown }; amount: { type: 'fixed' | 'percentageOf' | 'lookup' | 'lookupRange' | 'lookupSum'; [key: string]: unknown }; priority: number; requiresReview?: boolean } }> = [];

  for (const item of sampleRules) {
    const component = await db.pricingComponent.upsert({ where: { productId_code: { productId: product.id, code: item.code } }, update: { name: item.name, kind: item.kind, label: item.name, active: true, version: 1 }, create: { productId: product.id, code: item.code, name: item.name, kind: item.kind, label: item.name, active: true, version: 1 } });
    await db.pricingRule.upsert({ where: { componentId_version: { componentId: component.id, version: 1 } }, update: { name: item.name, active: true, expr: JSON.stringify(item.expr), priority: item.expr.priority }, create: { componentId: component.id, version: 1, name: item.name, active: true, expr: JSON.stringify(item.expr), priority: item.expr.priority } });
  }
  console.log(JSON.stringify({ product: product.slug, documentTypes: types.size, template: template.code, mappings: mappingDefinitions.length, pricingComponents: sampleRules.length, storageKey: templateStorageKey }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
