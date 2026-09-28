/**
 * PDF rasterisation for OCR (mupdf — open source, WASM build for Node).
 *
 * Uploaded PDFs (scans) must be rendered to an image before Tesseract can read
 * them. Returns null when mupdf is unavailable or cannot open the file —
 * callers fall back to NEEDS_REVIEW rather than guessing at content.
 *
 * mupdf 1.x ships an ESM graph that uses top-level await, so it MUST be pulled
 * in with a dynamic `import()`; `require('mupdf')` throws
 * ERR_REQUIRE_ASYNC_MODULE under Node's CJS loader.
 */
export async function rasterizePdfPage(input: Buffer, pageIndex = 0): Promise<Buffer | null> {
  try {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(new Uint8Array(input), 'application/pdf');
    const page = doc.loadPage(pageIndex);
    // 2x scale keeps OCR accuracy good on typical A4 scans.
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(2, 2),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );
    const png = Buffer.from(pixmap.asPNG());
    return png.length > 0 ? png : null;
  } catch {
    return null;
  }
}
