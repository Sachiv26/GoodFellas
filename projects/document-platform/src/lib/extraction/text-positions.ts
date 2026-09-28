/**
 * Shared 2D point / rectangle types modeled after PDF-lib's PDFDict / point
 * semantics.
 *
 * NOTE: coordinates in the PDF spec are canonically "up" (in 1/72 of an inch,
 * with origin at bottom-left of the page). Our ALV(9) coordinate map was
 * extracted with PDF data coordinates, which we interpret as Top-left origin
 * for mapping purposes. The PDF population layer will translate between PDF
 * data coordinates and device pixel / screen coordinates on demand.
 */
export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundingBox {
  /** PDF data coordinate (1/72 inch from bottom-left, y increasing upward). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Origin for fill and render operations: 'top-left' is the normal case when
    writing overlays onto an existing PDF page using pdf-lib. */
  origin: 'top-left' | 'bottom-left';
}

export interface PdfCoords {
  pageWidth: number;
  pageHeight: number;
  /** Conversion factor from PDF data units to device units (rounded). */
  scale?: number;
  /** Offset applied when placing glyphs onto a given page. */
  offsetX?: number;
  offsetY?: number;
}
