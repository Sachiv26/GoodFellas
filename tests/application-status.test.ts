import { describe, expect, it } from '@jest/globals';
import { decideApplicationStatus, type StatusDecisionInput } from '@/server/services/processing-service';

const ID = 'doc-type-id';
const PROOF = 'proof-type-id';
const DISC = 'disc-type-id';
const required = [ID, PROOF, DISC];

const uploaded = (documentTypeId: string, status = 'UPLOADED') => ({ documentTypeId, status, latestExtraction: null });
const extracted = (documentTypeId: string) => ({ documentTypeId, status: 'PROCESSED', latestExtraction: { status: 'COMPLETED', fieldCount: 12 } });

describe('decideApplicationStatus', () => {
  it('stays DOCUMENTS_REQUIRED while a required document is missing', () => {
    const input: StatusDecisionInput = { requiredDocumentTypeIds: required, documents: [uploaded(ID), uploaded(PROOF)] };
    expect(decideApplicationStatus(input).next).toBe('DOCUMENTS_REQUIRED');
  });

  it('is DOCUMENTS_UPLOADED as soon as every required document exists', () => {
    const input: StatusDecisionInput = { requiredDocumentTypeIds: required, documents: [uploaded(ID), uploaded(PROOF), uploaded(DISC)] };
    expect(decideApplicationStatus(input).next).toBe('DOCUMENTS_UPLOADED');
  });

  it('is COMPLETED once every required document is processed and extracted', () => {
    const input: StatusDecisionInput = { requiredDocumentTypeIds: required, documents: [extracted(ID), extracted(PROOF), extracted(DISC)] };
    expect(decideApplicationStatus(input).next).toBe('COMPLETED');
  });

  it('routes a document needing review to DOCUMENT_REVIEW even when the rest are complete', () => {
    const input: StatusDecisionInput = { requiredDocumentTypeIds: required, documents: [extracted(ID), extracted(PROOF), uploaded(DISC, 'NEEDS_REVIEW')] };
    expect(decideApplicationStatus(input).next).toBe('DOCUMENT_REVIEW');
  });

  it('does not report COMPLETED when an extraction produced no fields', () => {
    const input: StatusDecisionInput = {
      requiredDocumentTypeIds: required,
      documents: [extracted(ID), extracted(PROOF), { documentTypeId: DISC, status: 'PROCESSED', latestExtraction: { status: 'COMPLETED', fieldCount: 0 } }],
    };
    expect(decideApplicationStatus(input).next).toBe('DOCUMENTS_UPLOADED');
  });

  it('ignores optional documents and extra uploads', () => {
    const input: StatusDecisionInput = { requiredDocumentTypeIds: [ID], documents: [extracted(ID), uploaded('optional-type', 'NEEDS_REVIEW')] };
    expect(decideApplicationStatus(input).next).toBe('COMPLETED');
  });

  it('does not get stuck when a product has no required documents', () => {
    expect(decideApplicationStatus({ requiredDocumentTypeIds: [], documents: [] }).next).toBe('COMPLETED');
  });
});
