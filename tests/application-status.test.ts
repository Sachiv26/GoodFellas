import { describe, expect, it } from '@jest/globals';
import {
  countBarcodeFields,
  decideApplicationStatus,
  type StatusDecisionInput,
} from '@/server/services/processing-service';

const ID = 'doc-type-id';
const PROOF = 'proof-type-id';
const DISC = 'disc-type-id';
const required = [ID, PROOF, DISC];

const uploaded = (documentTypeId: string, status = 'UPLOADED') => ({ documentTypeId, status, barcodeFieldCount: 0 });
// A disc only counts as usable once its barcode yielded vehicle data, so the
// helper takes a decoded-field count (default 6 = a good decode).
const processed = (documentTypeId: string, barcodeFieldCount = 6) => ({ documentTypeId, status: 'PROCESSED', barcodeFieldCount });

describe('decideApplicationStatus', () => {
  it('stays DOCUMENTS_REQUIRED while a required document is missing', () => {
    const input: StatusDecisionInput = { requiredDocumentTypeIds: required, documents: [uploaded(ID), uploaded(PROOF)] };
    expect(decideApplicationStatus(input).next).toBe('DOCUMENTS_REQUIRED');
  });

  it('is DOCUMENTS_UPLOADED as soon as every required document exists', () => {
    const input: StatusDecisionInput = { requiredDocumentTypeIds: required, documents: [uploaded(ID), uploaded(PROOF), uploaded(DISC)] };
    expect(decideApplicationStatus(input).next).toBe('DOCUMENTS_UPLOADED');
  });

  it('is COMPLETED once every required document is processed', () => {
    const input: StatusDecisionInput = { requiredDocumentTypeIds: required, documents: [processed(ID), processed(PROOF), processed(DISC)] };
    expect(decideApplicationStatus(input).next).toBe('COMPLETED');
  });

  it('routes a document needing review to DOCUMENT_REVIEW even when the rest are complete', () => {
    const input: StatusDecisionInput = { requiredDocumentTypeIds: required, documents: [processed(ID), processed(PROOF), uploaded(DISC, 'NEEDS_REVIEW')] };
    expect(decideApplicationStatus(input).next).toBe('DOCUMENT_REVIEW');
  });

  it('does not report COMPLETED when the disc barcode decoded no vehicle data', () => {
    // This is the no-OCR/no-AI reality: an unreadable disc means no vehicle
    // details, so the application must go to review rather than price off
    // empty values.
    const input: StatusDecisionInput = {
      requiredDocumentTypeIds: required,
      documents: [processed(ID), processed(PROOF), processed(DISC, 0)],
    };
    expect(decideApplicationStatus(input).next).toBe('DOCUMENT_REVIEW');
  });

  it('ignores optional documents and extra uploads', () => {
    const input: StatusDecisionInput = { requiredDocumentTypeIds: [ID], documents: [processed(ID), uploaded('optional-type', 'NEEDS_REVIEW')] };
    expect(decideApplicationStatus(input).next).toBe('COMPLETED');
  });

  it('does not get stuck when a product has no required documents', () => {
    expect(decideApplicationStatus({ requiredDocumentTypeIds: [], documents: [] }).next).toBe('COMPLETED');
  });
});

describe('countBarcodeFields', () => {
  it('counts only the values a decode actually produced', () => {
    expect(
      countBarcodeFields({ fields: { registrationNumber: 'ABC123GP', gvm: null, tareWeight: '' } })
    ).toBe(1);
  });

  it('counts a stored payload JSON string', () => {
    expect(countBarcodeFields(JSON.stringify({ fields: { make: 'NISSAN', vin: 'ADNUSN1D5U0062028' } }))).toBe(2);
  });

  it('treats unparseable or empty payloads as zero fields', () => {
    expect(countBarcodeFields('not json')).toBe(0);
    expect(countBarcodeFields({ fields: {} })).toBe(0);
    expect(countBarcodeFields(null)).toBe(0);
  });
});
