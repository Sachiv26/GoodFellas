import { appConfig } from '@/lib/config';
import type { OcrProvider, OcrResult, OcrWord } from './index';
import type { ExtractedField } from '@/lib/extraction/types';
import type { ExtractionSource, FieldValidationStatus } from '@prisma/client';

const FIELD_NAMES: Record<string, string[]> = {
  SOUTH_AFRICAN_ID: ['idNumber', 'surname', 'firstNames', 'initials', 'dateOfBirth', 'gender', 'citizenship', 'documentType'],
  PROOF_OF_RESIDENCE: ['name', 'surname', 'idNumber', 'addressLine1', 'addressLine2', 'suburb', 'city', 'province', 'postalCode', 'documentDate', 'issuer', 'accountNumber', 'referenceNumber'],
  VEHICLE_LICENCE_DISC: ['registrationNumber', 'licenceNumber', 'vehicleRegisterNumber', 'ownerName', 'ownerIdNumber', 'vin', 'chassisNumber', 'engineNumber', 'make', 'model', 'seriesName', 'vehicleType', 'tareWeight', 'gvm', 'issueDate', 'expiryDate', 'discNumber', 'odometer'],
};
function parseJson(text: string): { text?: string; fields?: unknown; rawText?: string } { const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(); const start = clean.indexOf('{'); const end = clean.lastIndexOf('}'); return JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean); }
function isStatus(value: unknown): value is FieldValidationStatus { return value === 'UNKNOWN' || value === 'VALID' || value === 'INVALID' || value === 'NEEDS_REVIEW' || value === 'CORRECTED'; }
export class CohereOcrProvider implements OcrProvider {
  readonly name = 'cohere';
  constructor(private readonly apiKey = appConfig.ocr.cohereApiKey, private readonly model = appConfig.ocr.cohereModel) { if (!apiKey) throw new Error('COHERE_API_KEY is required when OCR_ENGINE=cohere'); }
  private async request(buffer: Buffer, prompt: string): Promise<string> {
    const mime = buffer[0] === 0xff && buffer[1] === 0xd8 ? 'image/jpeg' : buffer[0] === 0x89 && buffer[1] === 0x50 ? 'image/png' : buffer[0] === 0x47 && buffer[1] === 0x49 ? 'image/gif' : buffer[0] === 0x52 && buffer[1] === 0x49 ? 'image/webp' : 'application/octet-stream';
    const response = await fetch('https://api.cohere.com/v2/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } }] }], response_format: { type: 'json_object' }, temperature: 0 }), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Cohere extraction failed (${response.status})`);
    const body = await response.json() as { message?: { content?: Array<{ text?: string }> } };
    return body.message?.content?.map((part) => part.text ?? '').join('\n') ?? '';
  }
  async recognize(buffer: Buffer): Promise<OcrResult> { const raw = await this.request(buffer, 'Transcribe all visible text accurately. Return only JSON: {"text":"..."}.'); const text = parseJson(raw).text ?? ''; const words: OcrWord[] = text.split(/\s+/).filter(Boolean).map((word, line) => ({ text: word, confidence: 0.9, bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, line })); return { text, confidence: 0.9, words, engine: this.name }; }
  async extractFields(buffer: Buffer, documentType: string, barcodeFields?: Record<string, string | null> | null): Promise<{ fields: ExtractedField[]; rawText: string | null }> { const allowed = FIELD_NAMES[documentType] ?? []; const prompt = `Extract only visibly present values from this South African document. Never guess or fabricate. Return JSON exactly as {"fields":[{"fieldName":"...","value":"... or null","confidence":0.0,"validationStatus":"VALID|NEEDS_REVIEW|INVALID|UNKNOWN","notes":[]}],"rawText":"..."}. Allowed fields: ${allowed.join(', ')}. Barcode supporting data: ${JSON.stringify(barcodeFields ?? {})}.`; const result = parseJson(await this.request(buffer, prompt)); const rows = Array.isArray(result.fields) ? result.fields as Array<{ fieldName?: string; value?: unknown; confidence?: unknown; validationStatus?: unknown; notes?: unknown }> : []; const fields = allowed.map((fieldName) => { const row = rows.find((item) => item?.fieldName === fieldName); const value = typeof row?.value === 'string' && row.value.trim() ? row.value.trim() : null; const confidence = typeof row?.confidence === 'number' && row.confidence >= 0 && row.confidence <= 1 ? row.confidence : null; return { fieldName, value, normalizedValue: value, confidence, source: 'AI' as ExtractionSource, boundingBox: null, validationStatus: isStatus(row?.validationStatus) ? row.validationStatus : (value ? 'NEEDS_REVIEW' : 'UNKNOWN'), validationNotes: Array.isArray(row?.notes) ? row.notes.map(String) : undefined }; }); return { fields, rawText: result.rawText ?? null }; }
}
