/**
 * Barcode extraction parser (open-source ZXing usage stub).
 *
 * The system will use ZXing or a similar open-source barcode decoder to
 * attempt to decode the licence disc barcode. This module normalises the raw
 * decoded payload and stores both the raw value and structured parsed data.
 *
 * Since barcode format can change, we keep BOTH:
 *   - rawValue (original decoded string)
 *   - decodedDataJson (structured parsed fields)
 */
import type { BarcodeDecodedData } from './types';

export interface BarcodeParseResult {
  rawValue: string;
  symbology: string;
  confidence: number;
  decodedData: BarcodeDecodedData;
}

export interface BarcodeDecoder {
  decode(buffer: Buffer): Promise<BarcodeParseResult | null>;
}

export class BarcodeParseFailure {
  constructor(
    public readonly rawValue: string,
    public readonly symbology: string | null,
    public readonly confidence: number | null,
    public readonly error: string
  ) {}
}

export function parseBarcodePayload(raw: string, symbology: string): BarcodeDecodedData {
  // Attempt to interpret common barcode payload formats.

  // 1. JSON payloads
  if (raw.startsWith('{')) {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      return {
        format: 'json',
        rawValue: raw,
        registrationNumber: extractString(json, 'registrationNumber', 'regNo', 'reg'),
        vehicleRegisterNumber: extractString(json, 'vehicleRegisterNumber', 'vehicleRegNo'),
        chassisNumber: extractString(json, 'chassisNumber', 'chassisNo', 'vin'),
        engineNumber: extractString(json, 'engineNumber', 'engineNo'),
        make: extractString(json, 'make'),
        model: extractString(json, 'model', 'seriesName'),
        seriesName: extractString(json, 'seriesName'),
        vehicleType: extractString(json, 'vehicleType'),
        tareWeight: extractNumber(json, 'tareWeight', 'tare'),
        gvm: extractNumber(json, 'gvm', 'grossVehicleMass'),
        issueDate: extractDate(json, 'issueDate'),
        expiryDate: extractDate(json, 'expiryDate'),
        discNumber: extractString(json, 'discNumber', 'discNo'),
        ownerName: extractString(json, 'ownerName', 'owner'),
        ownerIdNumber: extractString(json, 'ownerIdNumber', 'ownerId', 'idNumber'),
        odometer: extractNumber(json, 'odometer'),
        licenceNumber: extractString(json, 'licenceNumber', 'licenceNo', 'licenseNumber'),
      };
    } catch {
      // Fall through to generic storage
    }
  }

  // 2. Pipe-delimited / key=value payloads
  const pairs = parseKeyValuePayload(raw);
  if (pairs.length > 0) {
    return {
      format: 'keyvalue',
      rawValue: raw,
      ...pairs.reduce<Partial<BarcodeDecodedData>>((acc, [k, v]) => {
        const upper = k.toUpperCase();
        if (upper.includes('REG')) acc.registrationNumber = v;
        if (upper.includes('VEHICLE') && upper.includes('REG')) acc.vehicleRegisterNumber = v;
        if (upper.includes('CHASSIS') || upper === 'VIN') acc.chassisNumber = v;
        if (upper.includes('ENGINE')) acc.engineNumber = v;
        if (upper === 'MAKE') acc.make = v;
        if (upper === 'MODEL' || upper.includes('SERIES')) acc.model = v;
        if (upper.includes('SERIES')) acc.seriesName = v;
        if (upper.includes('VEHICLE') && upper.includes('TYPE')) acc.vehicleType = v;
        if (upper.includes('TARE')) acc.tareWeight = v;
        if (upper.includes('GVM') || upper.includes('GROSS')) acc.gvm = v;
        if (upper.includes('ISSUE')) acc.issueDate = v;
        if (upper.includes('EXPIRY') || upper.includes('EXPIR')) acc.expiryDate = v;
        if (upper.includes('DISC')) acc.discNumber = v;
        if (upper.includes('OWNER')) acc.ownerName = v;
        if (upper.includes('ID') && upper.includes('OWNER')) acc.ownerIdNumber = v;
        if (upper === 'ODOMETER') acc.odometer = v;
        if (upper.includes('LICENCE') || upper.includes('LICENSE')) acc.licenceNumber = v;
        return acc;
      }, {}),
    } as BarcodeDecodedData;
  }

  // 3. Fallback: store raw and attempt positional decode
  return {
    format: 'raw',
    rawValue: raw,
    registrationNumber: raw.split(/[|\\s,;]+/)[0] ?? null,
  };
}

function extractString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      const val = obj[key];
      if (typeof val === 'string') return val;
      if (typeof val === 'number') return String(val);
    }
  }
  return null;
}

function extractNumber(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      const val = obj[key];
      if (typeof val === 'number') return String(val);
      if (typeof val === 'string') {
        const digits = val.replace(/\D/g, '');
        if (digits) return digits;
      }
    }
  }
  return null;
}

function extractDate(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      if (typeof obj[key] === 'string') {
        const raw = obj[key] as string;
        // Try ISO first
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
        // Try dd/mm/yyyy
        const dmy = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
        if (dmy) {
          const [, dd, mm, yyyy] = dmy;
          return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
        }
        return raw.slice(0, 10);
      }
    }
  }
  return null;
}

function parseKeyValuePayload(raw: string): Array<[string, string]> {
  const results: Array<[string, string]> = [];

  // Try pipe-delimited key=value pairs
  const pipeSegments = raw.split('|');
  if (pipeSegments.length > 1) {
    for (const seg of pipeSegments) {
      const eqIdx = seg.indexOf('=');
      if (eqIdx > 0) {
        results.push([seg.slice(0, eqIdx).trim(), seg.slice(eqIdx + 1).trim()]);
      }
    }
    if (results.length > 0) return results;
  }

  // Try comma-delimited key=value
  const commaSegments = raw.split(',');
  if (commaSegments.length > 1) {
    for (const seg of commaSegments) {
      const eqIdx = seg.indexOf('=');
      if (eqIdx > 0) {
        results.push([seg.slice(0, eqIdx).trim(), seg.slice(eqIdx + 1).trim()]);
      }
    }
    if (results.length > 0) return results;
  }

  // Try space-delimited key:value
  const spaceSegments = raw.split(/\s+/);
  if (spaceSegments.length > 1) {
    for (const seg of spaceSegments) {
      const colonIdx = seg.indexOf(':');
      if (colonIdx > 0) {
        results.push([seg.slice(0, colonIdx).trim(), seg.slice(colonIdx + 1).trim()]);
      }
    }
  }

  return results;
}
