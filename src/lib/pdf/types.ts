/**
 * Shared PDF module types.
 *
 * The ALV(9)(2011/07) template has no AcroForm fields, so population is done
 * with coordinate-based overlays driven by data (PdfFieldMapping rows) rather
 * than hard-coded coordinates in generation code.
 */

/** How a PDF field value is rendered onto the page. */
export type FieldKind = 'TEXT' | 'CHARACTER_BOXES' | 'CHECKBOX' | 'DATE';

/** Logical section of the ALV(9) form a field belongs to. */
export type PdfSection =
  | 'OWNER'
  | 'ADDRESS'
  | 'ORGANISATION_PROXY'
  | 'ORGANISATION_REPRESENTATIVE'
  | 'VEHICLE'
  | 'DECLARATION'
  | 'OFFICE_USE';

/** Axis-aligned rectangle in PDF points, top-left origin (yTop from page top). */
export interface PdfRect {
  page: number;
  x: number;
  yTop: number;
  width: number;
  height: number;
}

/**
 * Character-box region (the form uses comb boxes for ID numbers, names,
 * registration numbers, VIN, etc.). Boxes are evenly spaced across the span.
 */
export interface PdfCharBoxes {
  page: number;
  x: number;
  yTop: number;
  width: number;
  height: number;
  count: number;
}

/** One option of a multiple-choice checkbox group (e.g. steering position). */
export interface PdfChoiceOption {
  /** Value that selects this option (case-insensitive match). */
  value: string;
  /** Cell to centre the X mark in. */
  x: number;
  yTop: number;
  width: number;
  height: number;
  page: number;
}

export interface PdfChoiceGroup {
  page: number;
  options: PdfChoiceOption[];
}

/** Date rendered as separate year/month/day segments (the form splits them). */
export interface PdfDateSegments {
  page: number;
  year: { x: number; yTop: number; width: number; height: number };
  month: { x: number; yTop: number; width: number; height: number };
  day: { x: number; yTop: number; width: number; height: number };
}

/** Union of coordinate payloads stored in PdfFieldMapping.coordinates (JSON). */
export type PdfFieldCoordinates =
  | ({ kind: 'text' } & PdfRect)
  | ({ kind: 'boxes' } & PdfCharBoxes)
  | ({ kind: 'choice' } & PdfChoiceGroup)
  | ({ kind: 'date' } & PdfDateSegments)
  | ({ kind: 'signature' } & PdfRect);

/** One configured mapping row: PDF field ← data source + coordinates. */
export interface PdfFieldMapEntry {
  section: PdfSection;
  /** Stable field key (matches PDF_FIELD in fields.ts / PdfFieldMapping.pdfFieldName). */
  pdfFieldName: string;
  /** Logical data source path, e.g. "ID.idNumber" (admin UI + audit readability). */
  sourcePath: string;
  kind: 'TEXT' | 'CHECKBOX' | 'DATE' | 'IMAGE';
  layout: 'TEXT' | 'TEXT_RIGHT_ALIGNED' | 'CHARACTER_BOXES' | 'CHECKBOX';
  coordinates: PdfFieldCoordinates;
  /** Optional value format hint (e.g. "YY:MM:DD", uppercase). */
  format?: string;
}
