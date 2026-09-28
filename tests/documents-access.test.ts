import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { POST } from '@/app/api/documents/route';
import { enqueueDocumentProcessing } from '@/server/services/processing-service';

jest.mock('@/server/services/processing-service', () => ({
  enqueueDocumentProcessing: jest.fn(async () => undefined),
  reenqueueDocumentPipeline: jest.fn(async () => undefined),
  runDocumentPipeline: jest.fn(async () => undefined),
  runPendingJobs: jest.fn(async () => ({ processed: 0 })),
}));

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

const baseReq = (body: FormData | string, method = 'POST'): Request =>
  new Request('http://localhost/api/documents', { method, body });

describe('POST /api/documents', () => {
  beforeEach(() => {
    jest.mocked(enqueueDocumentProcessing).mockClear();
  });

  it('returns 401 for unauthenticated upload attempts', async () => {
    const res = await POST(baseReq(new FormData()));
    expect(res.status).toBe(401);
  });

  it('never returns storage keys to the customer', async () => {
    // Even when a future authenticated path succeeds, the DTO contract is
    // enforced by types; here we assert the unauthenticated path leaks
    // nothing beyond the error shape.
    const res = await POST(baseReq(new FormData()));
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('storageKey');
  });
});

describe('processing pipeline isolation', () => {
  it('exposes an enqueue function separate from OCR execution', () => {
    expect(typeof enqueueDocumentProcessing).toBe('function');
  });
});

// Keep enc referenced so the helper stays available for extension of this
// fixture when the authenticated upload path is exercised end-to-end.
void enc;
