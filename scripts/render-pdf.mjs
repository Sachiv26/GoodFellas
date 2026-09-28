/**
 * Dev-only helper: render PDF pages to PNG so the ALV(9) form layout and the
 * generated overlay can be verified visually.
 *
 * Usage: node scripts/render-pdf.mjs <pdf> [outPrefix] [scale]
 */
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from 'mupdf';

const input = process.argv[2] ?? 'prisma/seed-assets/vehiclelicenserenewalform.pdf';
const outPrefix = process.argv[3] ?? 'tmp/render';
const scale = Number(process.argv[4] ?? 2);

const buffer = fs.readFileSync(input);
const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
const pageCount = doc.countPages();
console.log(`pages: ${pageCount}`);

for (let i = 0; i < pageCount; i++) {
  const page = doc.loadPage(i);
  const matrix = mupdf.Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
  const png = pixmap.asPNG();
  const out = `${outPrefix}-p${i + 1}.png`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(png));
  console.log(`wrote ${out} (${pixmap.getWidth()}x${pixmap.getHeight()})`);
}
