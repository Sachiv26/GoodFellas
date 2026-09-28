import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { getStorage, generatedPdfStorageKey } from '@/lib/storage';
import { resolveApplicationData } from '@/server/services/application-data-service';

const PROXY_ASSET = 'prisma/seed-assets/goodfellas_proxy_authorisation.pdf';
function safeText(value: unknown): string { return value == null ? '' : String(value).replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '').trim(); }

/**
 * AcroForm field names, verified by rendering the template with each field
 * pre-filled with its own name and reading back the printed labels.
 *
 * The template's field names bear NO relationship to the order of the fields
 * on the page, so they must not be assigned positionally: in the template
 * `text_1` is the E-mail box, `text_3` is the Identity number, `text_9` is the
 * contact telephone and `text_12` is "Signed at (place)". Writing them in the
 * order they appear in the file puts each value in the wrong box on a legally
 * significant document.
 */
const FIELD = {
  fullName: 'text_6',
  identityNumber: 'text_3',
  contactTelephone: 'text_9',
  email: 'text_1',
  registrationNumber: 'text_11',
  licenceNumber: 'text_8',
  make: 'text_18',
  modelSeries: 'text_5',
  chassisOrVin: 'text_2',
  signedAt: 'text_12',
  signedDate: 'text_13',
  signature: 'text_4',
  signaturePrintedName: 'text_10',
  witnessSignature: 'text_14',
  witnessFullName: 'text_15',
} as const;

/** Owner display name: surname + first names, or the organisation name. */
function ownerDisplayName(data: Awaited<ReturnType<typeof resolveApplicationData>>): string {
  const full = [data.owner.surname, data.owner.firstNames].filter(Boolean).join(' ');
  return full || data.organisationProxy.identificationNumber || '';
}

export async function generateProxyPdf(applicationId: string, userId: string) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId }, select: { id: true, applicationNumber: true } });
  if (!app) throw new Error('APPLICATION_NOT_FOUND');
  const data = await resolveApplicationData(applicationId);
  const pdf = await PDFDocument.load(await fs.readFile(path.resolve(process.cwd(), PROXY_ASSET)));
  const form = pdf.getForm();
  const today = new Date().toISOString().slice(0, 10);
  const set = (name: string, value: unknown) => form.getTextField(name).setText(safeText(value));

  // Owner (grantor) — from the ID document / customer profile.
  set(FIELD.fullName, ownerDisplayName(data));
  set(FIELD.identityNumber, data.owner.idNumber ?? data.owner.businessRegistrationNumber);
  set(FIELD.contactTelephone, data.owner.cellphone);
  set(FIELD.email, data.owner.email);

  // Vehicle — from the licence disc barcode, which is authoritative.
  set(FIELD.registrationNumber, data.vehicle.registrationNumber);
  set(FIELD.licenceNumber, data.vehicle.licenceNumber);
  set(FIELD.make, data.vehicle.make);
  // Model / series is intentionally left blank: the disc barcode does not carry
  // a model value, and the printed description ("Pick-up / Bakkie") is the
  // vehicle TYPE, not the model. It is already captured elsewhere on the form.
  set(FIELD.chassisOrVin, data.vehicle.vin ?? data.vehicle.chassisNumber);

  // Signature block. The place is not on the barcode; fall back to the owner's
  // city and finally to a neutral value rather than leaving the box ambiguous.
  set(FIELD.signedAt, data.owner.city ?? data.owner.suburb ?? 'South Africa');
  set(FIELD.signedDate, today);
  // Pre-fill the printed-name box so the signature block is complete; the
  // signature itself is applied later by signProxyPdf.
  set(FIELD.signaturePrintedName, ownerDisplayName(data));
  // Witness fields are deliberately left blank for the witness to complete.

  const key = generatedPdfStorageKey(applicationId, randomUUID());
  await getStorage().put(key, Buffer.from(await pdf.save()), 'application/pdf');
  return prisma.generatedDocument.create({ data: { applicationId, storageKey: key, fileName: `${app.applicationNumber}-proxy-authorisation.pdf`, mimeType: 'application/pdf', createdBy: userId, extractionSnapshot: { kind: 'PROXY', generatedAt: new Date().toISOString(), witnessLeftBlank: true } } });
}

/**
 * Whether the application has a signed proxy authorisation.
 *
 * Single source of truth for the payment gate: the dashboard, the payment page
 * and `payment-service` all call this so they cannot drift apart on what counts
 * as "signed" (a signed PDF is a signed PDF regardless of which proxy
 * generation it came from).
 */
export async function isProxySigned(applicationId: string, userId?: string): Promise<boolean> {
  const document = await prisma.generatedDocument.findFirst({
    where: {
      applicationId,
      fileName: { endsWith: '-proxy-authorisation.pdf' },
      ...(userId ? { createdBy: userId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { extractionSnapshot: true },
  });
  const snapshot = document?.extractionSnapshot;
  return (
    !!snapshot &&
    typeof snapshot === 'object' &&
    (snapshot as Record<string, unknown>).signatureProvided === true
  );
}

export async function signProxyPdf(applicationId: string, userId: string, documentId: string, signature: string) {
  const doc = await prisma.generatedDocument.findFirst({ where: { id: documentId, applicationId, createdBy: userId, fileName: { endsWith: '-proxy-authorisation.pdf' } } });
  if (!doc) throw new Error('PROXY_NOT_FOUND');
  const clean = safeText(signature).slice(0, 120);
  if (!clean) throw new Error('SIGNATURE_REQUIRED');
  const storage = getStorage();
  const pdf = await PDFDocument.load(await storage.get(doc.storageKey));
  // text_4 is the "Signature:" box. This previously wrote to text_12, which is
  // "Signed at (place)" — so the signature landed in the place-of-signing field
  // and the real signature box stayed empty.
  pdf.getForm().getTextField(FIELD.signature).setText(clean);
  await storage.put(doc.storageKey, Buffer.from(await pdf.save()), 'application/pdf');
  await prisma.generatedDocument.update({ where: { id: doc.id }, data: { extractionSnapshot: { ...(typeof doc.extractionSnapshot === 'object' && doc.extractionSnapshot ? doc.extractionSnapshot as Record<string, unknown> : {}), signedAt: new Date().toISOString(), signatureProvided: true } as any } });
  return doc;
}
