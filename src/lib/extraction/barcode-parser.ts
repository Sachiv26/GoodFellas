/**
 * Licence disc barcode parsing.
 *
 * The eNaTIS disc barcode payload format is NOT guaranteed to stay stable, so
 * parsing is fully configurable and the RAW value is always retained alongside
 * any structured result (see BarcodeExtraction.rawValue / decodedDataJson).
 *
 * Supported payload shapes:
 *   - JSON object                         e.g. {"registrationNumber":"ABC123GP"}
 *   - Key=value / key:value pairs         e.g. REG=ABC123GP|VIN=...
 *   - Delimited positional with a configurable field order
 *
 * Every candidate value must pass the structural validator for its field,
 * otherwise it is dropped (recorded as a warning) — values are never invented.
 */
export interface BarcodeParseResult {
  format: 'JSON' | 'KEY_VALUE' | 'DELIMITED' | 'ENATIS' | 'UNKNOWN';
  fields: Record<string, string | null>;
  warnings: string[];
}

export interface BarcodeParseOptions {
  /** Configured field order for positional (delimited) payloads. */
  fieldOrder?: string[];
  /** Delimiters to try, in order. */
  delimiters?: string[];
}

/**
 * Default positional field order. This is SAMPLE CONFIGURATION (stored in the
 * product config and editable by an admin) — it is not a published
 * specification. Fields that fail validation are discarded.
 */
export const DEFAULT_BARCODE_FIELD_ORDER: string[] = [
  'registrationNumber',
  'licenceNumber',
  'vehicleRegisterNumber',
  'ownerName',
  'ownerIdNumber',
  'vin',
  'chassisNumber',
  'engineNumber',
  'make',
  'model',
  'seriesName',
  'vehicleType',
  'tareWeight',
  'gvm',
  'issueDate',
  'expiryDate',
  'discNumber',
];

const DEFAULT_DELIMITERS = ['|', ';', '\t', ','];

export const BARCODE_KEY_ALIASES: Record<string, string> = {
  reg: 'registrationNumber',
  regno: 'registrationNumber',
  registration: 'registrationNumber',
  registrationnumber: 'registrationNumber',
  licence: 'licenceNumber',
  licenceno: 'licenceNumber',
  licencenumber: 'licenceNumber',
  licno: 'licenceNumber',
  vehregno: 'vehicleRegisterNumber',
  vehicleregister: 'vehicleRegisterNumber',
  vehicleregisternumber: 'vehicleRegisterNumber',
  vregno: 'vehicleRegisterNumber',
  vin: 'vin',
  chassis: 'chassisNumber',
  chassisnumber: 'chassisNumber',
  chassisno: 'chassisNumber',
  engine: 'engineNumber',
  enginenumber: 'engineNumber',
  engineno: 'engineNumber',
  make: 'make',
  manufacturer: 'make',
  model: 'model',
  series: 'seriesName',
  seriesname: 'seriesName',
  type: 'vehicleType',
  vehicletype: 'vehicleType',
  tare: 'tareWeight',
  tareweight: 'tareWeight',
  gvm: 'gvm',
  issuedate: 'issueDate',
  expiry: 'expiryDate',
  expirydate: 'expiryDate',
  validuntil: 'expiryDate',
  disc: 'discNumber',
  discnumber: 'discNumber',
  owner: 'ownerName',
  ownername: 'ownerName',
  ownerid: 'ownerIdNumber',
  owneridnumber: 'ownerIdNumber',
  odometer: 'odometer',
};

/** Structural validators per field. Return false to reject a candidate value. */
export const BARCODE_FIELD_VALIDATORS: Record<string, (value: string) => boolean> = {
  registrationNumber: (v) => /^[A-Z0-9\s-]{4,15}$/i.test(v.trim()),
  licenceNumber: (v) => /^\d{4,12}$/.test(v.replace(/\D/g, '')),
  vehicleRegisterNumber: (v) => /^[A-Z0-9-]{3,20}$/i.test(v.trim()),
  ownerName: (v) => /[A-Za-z]{3}/.test(v),
  ownerIdNumber: (v) => /^\d{13}$/.test(v.replace(/\D/g, '')),
  vin: (v) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(v.trim()),
  chassisNumber: (v) => v.trim().length >= 6,
  engineNumber: (v) => v.trim().length >= 6,
  make: (v) => v.trim().length >= 2,
  model: (v) => v.trim().length >= 1,
  seriesName: (v) => v.trim().length >= 1,
  vehicleType: (v) => v.trim().length >= 3,
  // Weights must be a bare number. The previous patterns stripped every
  // non-digit before testing, so a corrupted value like "18901055" (two
  // figures glued together) validated as a legitimate 7-digit GVM. Stripping
  // hides exactly the corruption these validators exist to catch.
  tareWeight: (v) => /^\d{2,6}$/.test(v.trim()),
  gvm: (v) => /^\d{2,7}$/.test(v.trim()),
  issueDate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v),
  expiryDate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v),
  discNumber: (v) => v.trim().length >= 3,
  odometer: (v) => /^\d{1,7}$/.test(v.replace(/\D/g, '')),
};

export function resolveKey(key: string): string | null {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized) return null;
  if (BARCODE_KEY_ALIASES[normalized]) return BARCODE_KEY_ALIASES[normalized]!;
  if (DEFAULT_BARCODE_FIELD_ORDER.includes(key)) return key;
  return null;
}

/**
 * eNaTIS licence disc payload ("%-delimited" segments).
 *
 * Real example decoded from a disc:
 *   %MVL1CC44%0143%10015DN%1%1001055WBVVR%CA722260%SNG528W%Pick-up / Bakkie%NISSAN%NP200%White / Wit%ADNUSN1D5U0062028%K7M
 *
 * The format is positional with no explicit keys, and the tokens are opaque:
 * the same letters carry different meanings per segment position, so they are
 * matched by POSITION, not by name. Recognised positions:
 *
 *   3  licence / disc number      e.g. `1001055WBVVR`
 *   5  registration number        e.g. `CA722260`
 *   6  vehicle register number    e.g. `SNG528W`
 *   7  vehicle type               e.g. `Pick-up / Bakkie`
 *   8  make                       e.g. `NISSAN`
 *   9  colour                     (not a priced field)
 *  10  VIN                        e.g. `ADNUSN1D5U0062028`
 *
 * The tare weight is embedded in the licence-number segment as a leading digit
 * run (`1001055` -> `1055`) and is exposed as `tareWeight`; the GVM is not in
 * the payload and is left null rather than inferred. Values that fail the
 * structural validator are dropped with a warning — never guessed.
 */
export const ENATIS_SEGMENT_FIELDS: Record<number, string> = {
  4: 'licenceNumber',
  5: 'registrationNumber',
  6: 'vehicleRegisterNumber',
  7: 'vehicleType',
  8: 'make',
  11: 'vin',
};

function tryEnatis(raw: string): BarcodeParseResult | null {
  if (!raw.includes('%')) return null;
  // A eNaTIS payload is a '%'-delimited segment list; require enough segments
  // that this cannot be a coincidental match on some other format.
  const segments = raw.split('%').filter((s) => s.trim() !== '');
  if (segments.length < 6) return null;

  const fields: Record<string, string | null> = {};
  const warnings: string[] = [];

  for (const [index, field] of Object.entries(ENATIS_SEGMENT_FIELDS)) {
    const segment = segments[Number(index)];
    if (!segment) continue;
    assignField(fields, warnings, field, segment);
  }

  // Tare weight: the digit run inside the licence-number segment. `1001055`
  // carries the tare as 1055; the trailing `WBVVR` is a checksum/check letter.
  const licenceSegment = segments[4] ?? '';
  const tare = licenceSegment.match(/^\d+?(\d{3,4})(?=[A-Z]|$)/);
  if (tare) assignField(fields, warnings, 'tareWeight', tare[1]!);

  if (Object.keys(fields).length === 0) return null;
  warnings.push('Disc barcode parsed using the eNaTIS segment layout');
  return { format: 'ENATIS', fields, warnings };
}

export function parseDiscBarcode(
  rawValue: string,
  options?: BarcodeParseOptions
): BarcodeParseResult {
  const raw = (rawValue ?? '').trim();
  if (!raw) return { format: 'UNKNOWN', fields: {}, warnings: ['Barcode value is empty'] };

  const jsonAttempt = tryJson(raw);
  if (jsonAttempt) return jsonAttempt;

  // The real eNaTIS disc payload is '%'-delimited, so it is tried before the
  // generic delimited/key-value heuristics that would mis-read its segments.
  const enatis = tryEnatis(raw);
  if (enatis) return enatis;

  const delimiters = options?.delimiters ?? DEFAULT_DELIMITERS;

  const keyValue = tryKeyValue(raw, delimiters);
  if (keyValue) return keyValue;

  const positional = tryPositional(
    raw,
    delimiters,
    options?.fieldOrder ?? DEFAULT_BARCODE_FIELD_ORDER
  );
  if (positional) return positional;

  return {
    format: 'UNKNOWN',
    fields: {},
    warnings: [
      'Barcode payload format is not recognised — raw value retained for admin review',
    ],
  };
}

function tryJson(raw: string): BarcodeParseResult | null {
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const fields: Record<string, string | null> = {};
    const warnings: string[] = [];
    for (const [key, value] of Object.entries(parsed)) {
      const canonical = resolveKey(key);
      if (!canonical || value === null || value === undefined) continue;
      assignField(fields, warnings, canonical, String(value));
    }
    return { format: 'JSON', fields, warnings };
  } catch {
    return null;
  }
}

function tryKeyValue(raw: string, delimiters: string[]): BarcodeParseResult | null {
  for (const delimiter of delimiters) {
    const segments = raw.split(delimiter);
    if (segments.length < 2) continue;
    let recognised = 0;
    const fields: Record<string, string | null> = {};
    const warnings: string[] = [];
    for (const segment of segments) {
      const match = segment.match(/^\s*([A-Za-z][A-Za-z0-9 _-]{1,30})\s*[=:]\s*(.*)$/);
      if (!match) {
        recognised = 0;
        break;
      }
      const canonical = resolveKey(match[1]!);
      if (!canonical) continue;
      recognised++;
      assignField(fields, warnings, canonical, match[2]!);
    }
    if (recognised >= 2) return { format: 'KEY_VALUE', fields, warnings };
  }
  return null;
}

function tryPositional(
  raw: string,
  delimiters: string[],
  fieldOrder: string[]
): BarcodeParseResult | null {
  for (const delimiter of delimiters) {
    const segments = raw.split(delimiter).map((s) => s.trim());
    if (segments.length < 3) continue;
    const fields: Record<string, string | null> = {};
    const warnings: string[] = [
      'Delimited barcode payload interpreted using the configured field order',
    ];
    segments.forEach((segment, index) => {
      const canonical = fieldOrder[index];
      if (!canonical) return;
      assignField(fields, warnings, canonical, segment);
    });
    if (Object.keys(fields).length > 0) return { format: 'DELIMITED', fields, warnings };
  }
  return null;
}

function assignField(
  fields: Record<string, string | null>,
  warnings: string[],
  field: string,
  value: string
): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  const validator = BARCODE_FIELD_VALIDATORS[field];
  if (validator && !validator(trimmed)) {
    warnings.push(`Rejected barcode value for "${field}" — failed structural validation`);
    return;
  }
  if (fields[field]) {
    warnings.push(`Multiple barcode values for "${field}" — first value kept`);
    return;
  }
  fields[field] = trimmed;
}

