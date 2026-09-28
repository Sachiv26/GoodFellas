import { describe, expect, it } from '@jest/globals';
import { extractLicenceDiscFields } from '@/lib/extraction/disc-extractor';
import { parseDiscBarcode } from '@/lib/extraction/barcode-parser';

const barcode = {
  registrationNumber: 'ABC123GP',
  tareWeight: '1055',
  gvm: '1800',
  expiryDate: '2025-03-31',
  vehicleType: 'MOTOR_CAR',
};

describe('licence disc extraction from barcode', () => {
  const fields = extractLicenceDiscFields({
    rawText: '',
    words: [],
    source: 'BARCODE',
    barcodeFields: barcode,
    barcodeConfidence: 0.9,
  });
  const by = (name: string) => fields.find((f) => f.fieldName === name);

  it('takes the money-affecting fields from the barcode, not the printed face', () => {
    expect(by('tareWeight')?.value).toBe('1055');
    expect(by('gvm')?.value).toBe('1800');
    expect(by('registrationNumber')?.value).toBe('ABC123GP');
  });

  it('marks barcode-sourced fields as BARCODE so provenance is auditable', () => {
    expect(by('tareWeight')?.source).toBe('BARCODE');
    expect(by('tareWeight')?.validationStatus).toBe('VALID');
  });

  it('never reports an AI source for a barcode-derived field', () => {
    expect(fields.some((f) => f.source === 'AI')).toBe(false);
  });

  it('leaves the weight null when the barcode does not supply one', () => {
    const partial = extractLicenceDiscFields({
      rawText: '',
      words: [],
      source: 'BARCODE',
      barcodeFields: { registrationNumber: 'ABC123GP' },
      barcodeConfidence: 0.9,
    });
    expect(partial.find((f) => f.fieldName === 'tareWeight')?.value).toBeNull();
  });
});

describe('eNaTIS disc barcode payload', () => {
  // Decoded from the real disc in prisma/seed-assets-era test data.
  const raw =
    '%MVL1CC44%0143%10015DN%1%1001055WBVVR%CA722260%SNG528W%Pick-up / Bakkie%NISSAN%NP200%White / Wit%ADNUSN1D5U0062028%K7M';

  it('parses the real %-delimited payload', () => {
    const result = parseDiscBarcode(raw);
    expect(result.format).toBe('ENATIS');
    expect(result.fields.registrationNumber).toBe('CA722260');
    expect(result.fields.vehicleRegisterNumber).toBe('SNG528W');
    expect(result.fields.make).toBe('NISSAN');
    expect(result.fields.vin).toBe('ADNUSN1D5U0062028');
  });

  it('extracts the tare weight embedded in the licence segment', () => {
    // The disc reads Tare/Tarra 1055 kg; the GVM (1890) is NOT in the payload.
    expect(parseDiscBarcode(raw).fields.tareWeight).toBe('1055');
  });

  it('leaves GVM null rather than inferring it from another field', () => {
    expect(parseDiscBarcode(raw).fields.gvm ?? null).toBeNull();
  });

  it('still parses the existing key=value format', () => {
    const result = parseDiscBarcode('REG=ABC123GP|TARE=1055|GVM=1800');
    expect(result.format).toBe('KEY_VALUE');
    expect(result.fields.tareWeight).toBe('1055');
  });
});

describe('disc barcode parser', () => {
  it('parses a key=value payload and validates the weight', () => {
    const result = parseDiscBarcode('REG=ABC123GP|TARE=1055|GVM=1800|EXPIRY=2025-03-31');
    expect(result.format).toBe('KEY_VALUE');
    expect(result.fields.registrationNumber).toBe('ABC123GP');
    expect(result.fields.tareWeight).toBe('1055');
  });

  it('drops a weight that fails structural validation instead of accepting it', () => {
    const result = parseDiscBarcode('REG=ABC123GP|TARE=not-a-number');
    expect(result.fields.tareWeight ?? null).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
