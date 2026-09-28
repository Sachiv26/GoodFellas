import { appConfig } from '@/lib/config';
import type { OcrProvider, OcrResult, OcrWord } from './index';
import type { ExtractedField } from '@/lib/extraction/types';
import type { ExtractionSource, FieldValidationStatus } from '@prisma/client';

interface GeminiPart { text?: string }
interface GeminiResponse { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> }
const FIELD_NAMES: Record<string, string[]> = {
  SOUTH_AFRICAN_ID: ['idNumber', 'surname', 'firstNames', 'initials', 'dateOfBirth', 'gender', 'citizenship', 'documentType'],
  PROOF_OF_RESIDENCE: ['name', 'surname', 'idNumber', 'addressLine1', 'addressLine2', 'suburb', 'city', 'province', 'postalCode', 'documentDate', 'issuer', 'accountNumber', 'referenceNumber'],
  VEHICLE_LICENCE_DISC: ['registrationNumber', 'licenceNumber', 'vehicleRegisterNumber', 'ownerName', 'ownerIdNumber', 'vin', 'chassisNumber', 'engineNumber', 'make', 'model', 'seriesName', 'vehicleType', 'tareWeight', 'gvm', 'issueDate', 'expiryDate', 'discNumber', 'odometer'],
};
function parseJson(text: string): { text?: string; fields?: unknown; rawText?: string } {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(clean); } catch { const start = clean.indexOf('{'); const end = clean.lastIndexOf('}'); if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1)); throw new Error('Gemini returned invalid JSON'); }
}
function fieldRows(fields: unknown): Array<{ fieldName?: string; value?: unknown; confidence?: unknown; validationStatus?: unknown; notes?: unknown }> {
  const normalizeLabel = (value: string) => {
    const key = value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const labels: Record<string, string> = { idnumber: 'idNumber', identitynumber: 'idNumber', surname: 'surname', lastname: 'surname', names: 'firstNames', firstnames: 'firstNames', givennames: 'firstNames', initials: 'initials', dateofbirth: 'dateOfBirth', dob: 'dateOfBirth', sex: 'gender', gender: 'gender', citizenship: 'citizenship', addressline1: 'addressLine1', addressline2: 'addressLine2', suburb: 'suburb', city: 'city', town: 'city', province: 'province', postalcode: 'postalCode', documentdate: 'documentDate', issuer: 'issuer', accountnumber: 'accountNumber', referencenumber: 'referenceNumber', registrationnumber: 'registrationNumber', licencenumber: 'licenceNumber', vehicleregisternumber: 'vehicleRegisterNumber', ownername: 'ownerName', owneridnumber: 'ownerIdNumber', vin: 'vin', chassisnumber: 'chassisNumber', enginenumber: 'engineNumber', make: 'make', model: 'model', seriesname: 'seriesName', vehicletype: 'vehicleType', tareweight: 'tareWeight', gvm: 'gvm', issuedate: 'issueDate', expirydate: 'expiryDate', discnumber: 'discNumber', odometer: 'odometer' };
    return labels[key];
  };
  if (Array.isArray(fields)) return fields.filter((row): row is { fieldName?: string; value?: unknown; confidence?: unknown; validationStatus?: unknown; notes?: unknown } => !!row && typeof row === 'object').map((row) => {
    const record = row as { fieldName?: string; label?: string; value?: unknown; text_content?: string; textContent?: string; confidence?: unknown; validationStatus?: unknown; notes?: unknown };
    return { fieldName: record.fieldName ?? (record.label ? normalizeLabel(record.label) : undefined), value: record.value ?? record.text_content ?? record.textContent, confidence: record.confidence, validationStatus: record.validationStatus, notes: record.notes };
  }).filter((row) => !!row.fieldName);
  if (fields && typeof fields === 'object') return Object.entries(fields as Record<string, unknown>).map(([fieldName, value]) => ({ fieldName, value: value && typeof value === 'object' && 'value' in value ? (value as { value?: unknown }).value : value, confidence: value && typeof value === 'object' && 'confidence' in value ? (value as { confidence?: unknown }).confidence : undefined, validationStatus: value && typeof value === 'object' && 'validationStatus' in value ? (value as { validationStatus?: unknown }).validationStatus : undefined, notes: value && typeof value === 'object' && 'notes' in value ? (value as { notes?: unknown }).notes : undefined }));
  return [];
}
function isStatus(value: unknown): value is FieldValidationStatus { return value === 'UNKNOWN' || value === 'VALID' || value === 'INVALID' || value === 'NEEDS_REVIEW' || value === 'CORRECTED'; }
export class GeminiOcrProvider implements OcrProvider {
  readonly name = 'gemini';
  constructor(private readonly apiKey = appConfig.ocr.geminiApiKey, private readonly model = appConfig.ocr.geminiModel) { if (!apiKey) throw new Error('GEMINI_API_KEY is required when OCR_ENGINE=gemini'); }
  private async request(parts: Array<Record<string, unknown>>, prompt: string): Promise<string> {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }, body: JSON.stringify({ contents: [{ role: 'user', parts: [...parts, { text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8192 } }), signal: AbortSignal.timeout(120_000) });
      lastStatus = response.status;
      if (response.ok) { const body = (await response.json()) as GeminiResponse; return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n').trim() ?? ''; }
      if (response.status !== 429 && response.status !== 503) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    throw new Error(`Gemini extraction failed (${lastStatus})`);
  }
  async recognize(buffer: Buffer): Promise<OcrResult> { const mimeType = buffer[0] === 0xff ? 'image/jpeg' : buffer[1] === 0x50 ? 'image/png' : 'application/pdf'; const result = parseJson(await this.request([{ inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }], 'Transcribe visible text only. Return JSON with a text property.')); const text = result.text ?? ''; return { text, confidence: 0.9, words: text.split(/\s+/).filter(Boolean).map((word, line) => ({ text: word, confidence: 0.9, bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, line })), engine: this.name }; }
  async extractFields(buffer: Buffer, documentType: string, barcodeFields?: Record<string, string | null> | null): Promise<{ fields: ExtractedField[]; rawText: string | null }> { const mimeType = buffer[0] === 0xff ? 'image/jpeg' : buffer[1] === 0x50 ? 'image/png' : 'application/pdf'; const allowed = FIELD_NAMES[documentType] ?? []; const prompt = `Extract only visibly present fields from this South African document. Never guess or fabricate. Return ONLY JSON: {"fields":[{"fieldName":"...","value":"... or null","confidence":0.0,"validationStatus":"VALID|NEEDS_REVIEW|INVALID|UNKNOWN","notes":[]}],"rawText":"..."}. Allowed fields: ${allowed.join(', ')}. Supporting barcode data: ${JSON.stringify(barcodeFields ?? {})}.`; const result = parseJson(await this.request([{ inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }], prompt)); const rows = fieldRows(result.fields); const fields: ExtractedField[] = allowed.map((fieldName) => { const row = rows.find((item) => item && typeof item === 'object' && (item as { fieldName?: string }).fieldName === fieldName) as { value?: unknown; confidence?: unknown; validationStatus?: unknown; notes?: unknown } | undefined; const value = typeof row?.value === 'string' && row.value.trim() ? row.value.trim() : null; const confidence = typeof row?.confidence === 'number' && row.confidence >= 0 && row.confidence <= 1 ? row.confidence : null; return { fieldName, value, normalizedValue: value, confidence, source: 'AI' as ExtractionSource, boundingBox: null, validationStatus: isStatus(row?.validationStatus) ? row.validationStatus : (value ? 'NEEDS_REVIEW' : 'UNKNOWN'), validationNotes: Array.isArray(row?.notes) ? row.notes.map(String) : undefined }; }); return { fields, rawText: result.rawText ?? null }; }
}
