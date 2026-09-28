import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { getStorage, generatedPdfStorageKey } from '@/lib/storage';
import { resolveApplicationData } from '@/server/services/application-data-service';
import { getPdfFieldDefinition } from '@/lib/pdf/fields';

function toPdfText(value: string): string { return value.replace(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '').trim(); }

export async function generateApplicationPdf(applicationId: string, createdBy: string) {
  const data = await resolveApplicationData(applicationId);
  const template = await prisma.pdfTemplate.findFirst({ where: { active: true }, include: { mappings: { where: { active: true } } } });
  if (!template) throw new Error('NO_ACTIVE_PDF_TEMPLATE');
  const snapshotApplication = await prisma.application.findUniqueOrThrow({ where: { id: applicationId }, include: { documents: { where: { status: { not: 'REPLACED' } }, include: { documentType: true, extractions: { orderBy: { createdAt: 'desc' }, take: 1, include: { fieldExtractions: true } }, barcodes: { orderBy: { decodedAt: 'desc' } } }, orderBy: { createdAt: 'desc' } } } });
  const extractionSnapshot = { generatedAt: new Date().toISOString(), applicationId, documents: snapshotApplication.documents.map((document) => ({ id: document.id, type: document.documentType.code, name: document.documentType.name, fileName: document.originalFileName, status: document.status, extraction: document.extractions[0] ?? null, barcodes: document.barcodes })) };
  const storage = getStorage();
  const pdf = await PDFDocument.load(await storage.get(template.storageKey));
  const form = pdf.getForm();
  const values: Record<string, string | null> = {};
  const put = (path: string, value: string | null | undefined) => { values[path] = value == null ? null : value; };
  put('ID.idNumber', data.owner.idNumber); put('ID.surname', data.owner.surname); put('ID.firstNames', data.owner.firstNames); put('ID.initials', data.owner.initials);
  put('CUSTOMER.email', data.owner.email); put('CUSTOMER.mobileNumber', data.owner.cellphone); put('OWNER.identificationType', data.owner.identificationType); put('OWNER.initials', data.owner.initials);
  put('POR.addressLine1', data.owner.postalAddress); put('POR.addressLine2', data.owner.streetAddress); put('POR.suburb', data.owner.suburb); put('POR.city', data.owner.city); put('POR.postalCode', data.owner.postalCode);
  put('APPLICATION.noticesPostal', 'true'); put('APPLICATION.ownerType', data.application.ownerType); put('APPLICATION.applicationDate', data.application.applicationDate);
  for (const [key, value] of Object.entries(data.owner)) put(`OWNER.${key}`, value);
  for (const [key, value] of Object.entries(data.vehicle)) put(`LICENCE_DISC.${key}`, value == null ? null : String(value));
  const groups = new Map<string, typeof template.mappings>();
  for (const mapping of template.mappings) { const list = groups.get(mapping.sourcePath) ?? []; list.push(mapping); groups.set(mapping.sourcePath, list); }
  for (const [sourcePath, mappings] of groups) {
    const rawValue = values[sourcePath];
    if (rawValue == null || rawValue === '') continue;
    const value = toPdfText(rawValue);
    if (!value) continue;
    if (mappings.some((mapping) => mapping.kind === 'CHECKBOX')) {
      const mapping = mappings[0];
      const enabled = value === 'true' || value === 'RSA_ID' || value === 'INDIVIDUAL';
      if (enabled) form.getCheckBox(mapping.pdfFieldName).check();
      continue;
    }
    mappings.sort((a, b) => a.pdfFieldName.localeCompare(b.pdfFieldName, undefined, { numeric: true }));
    mappings.forEach((mapping, index) => {
      if (getPdfFieldDefinition(mapping.pdfFieldName)?.signature) return;
      form.getTextField(mapping.pdfFieldName).setText(value[index] ?? '');
    });
  }
  const generatedId = randomUUID(); const storageKey = generatedPdfStorageKey(applicationId, generatedId); const output = Buffer.from(await pdf.save()); await storage.put(storageKey, output, 'application/pdf');
  return prisma.generatedDocument.create({ data: { applicationId, templateId: template.id, storageKey, fileName: `${applicationId}-${template.code}-v${template.version}.pdf`, mimeType: 'application/pdf', createdBy, extractionSnapshot: extractionSnapshot as any } });
}