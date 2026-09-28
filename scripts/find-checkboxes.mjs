// Dev utility: locate small square path rects (checkbox candidates) on each page.
// usage: node scripts/find-checkboxes.mjs
import { PDFDocument, PDFName, PDFRawStream, PDFDict, decodePDFRawStream } from 'pdf-lib';
import * as fs from 'fs';

function contentOf(page) {
  const node = page.node ?? page;
  const contents = node.Contents ?? node.get(PDFName.of('Contents'));
  const streams = [];
  if (contents && contents.asArray) {
    for (const item of contents.asArray()) streams.push(item);
  } else if (contents) {
    streams.push(contents);
  }
  let out = '';
  for (const s of streams) {
    if (s instanceof PDFRawStream) {
      const decoded = decodePDFRawStream(s).decode();
      out += Buffer.from(decoded).toString('latin1');
    } else if (s && typeof s.getContents === 'function') {
      out += Buffer.from(s.getContents()).toString('latin1');
    }
  }
  return out;
}

function tokens(text) {
  const re = /([+-]?(?:\d+\.\d+|\d+))|(\/[^\s/\[\]()<>]+)|(\[|\])|(\()|([A-Za-z'"*]+)|(<[^>]*>)|(\S)/g;
  const ops = [];
  let stack = [];
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) stack.push(parseFloat(m[1]));
    else if (m[2] !== undefined) stack.push(m[2]);
    else if (m[3] !== undefined) stack.push(m[3]);
    else if (m[4] !== undefined) stack.push('(');
    else if (m[5] !== undefined) stack.push(m[5]);
    else if (m[6] !== undefined) stack.push('<hex>');
    else stack.push(m[7]);
    const op = m[5];
    if (op && op.length <= 3) {
      ops.push({ op, operands: stack });
      stack = [];
    }
  }
  return ops;
}

function findSquares(text) {
  const ops = tokens(text);
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const out = [];
  const apply = (x, y) => ({
    x: ctm[0] * x + ctm[2] * y + ctm[4],
    y: ctm[1] * x + ctm[3] * y + ctm[5],
  });
  let path = [];
  for (const { op, operands } of ops) {
    if (op === 'q') stack.push([...ctm]);
    else if (op === 'Q') { const p = stack.pop(); if (p) ctm = p; }
    else if (op === 'cm' && operands.length >= 6) {
      const m = operands.slice(-6);
      ctm = [
        ctm[0] * m[0] + ctm[2] * m[1],
        ctm[1] * m[0] + ctm[3] * m[1],
        ctm[0] * m[2] + ctm[2] * m[3],
        ctm[1] * m[2] + ctm[3] * m[3],
        ctm[0] * m[4] + ctm[2] * m[5] + ctm[4],
        ctm[1] * m[4] + ctm[3] * m[5] + ctm[5],
      ];
    }
    else if (op === 're' && operands.length >= 4) {
      const [x, y, w, h] = operands.slice(-4);
      const p1 = apply(x, y), p2 = apply(x + w, y + h);
      path.push({ x0: Math.min(p1.x, p2.x), x1: Math.max(p1.x, p2.x), y0: Math.min(p1.y, p2.y), y1: Math.max(p1.y, p2.y) });
    } else if (op === 'm' && operands.length >= 2) {
      const [x, y] = operands.slice(-2);
      const p = apply(x, y);
      path.push({ x0: p.x, x1: p.x, y0: p.y, y1: p.y });
    } else if (op === 'l' && operands.length >= 2) {
      const [x, y] = operands.slice(-2);
      const p = apply(x, y);
      path.push({ x0: p.x, x1: p.x, y0: p.y, y1: p.y });
    } else if (op === 'h') { /* close */ }
    else if (op === 're' || op === 'f' || op === 'f*' || op === 'B' || op === 'b' || op === 'S' || op === 's') {
      if (path.length > 0) {
        const x0 = Math.min(...path.map(p => p.x0));
        const x1 = Math.max(...path.map(p => p.x1));
        const y0 = Math.min(...path.map(p => p.y0));
        const y1 = Math.max(...path.map(p => p.y1));
        const w = x1 - x0, h = y1 - y0;
        if (w >= 4 && w <= 18 && h >= 4 && h <= 18 && Math.abs(w - h) < 3) {
          out.push({ x: x0, yTop: 841.86 - y1, w, h, op });
        }
      }
      path = [];
    }
    else if (['n', 'W', 'W*'].includes(op)) {
      if (op === 'n') path = [];
    }
  }
  return out;
}

const pdf = fs.readFileSync('prisma/seed-assets/vehiclelicenserenewalform.pdf');
const doc = await PDFDocument.load(pdf);
for (let i = 0; i < doc.getPageCount(); i++) {
  const text = contentOf(doc.getPage(i));
  const squares = findSquares(text);
  console.log(`=== PAGE ${i + 1}: ${squares.length} squares ===`);
  squares.sort((a, b) => a.yTop - b.yTop || a.x - b.x);
  for (const s of squares) {
    console.log(`x=${s.x.toFixed(1)} yTop=${s.yTop.toFixed(1)} w=${s.w.toFixed(1)} h=${s.h.toFixed(1)} op=${s.op}`);
  }
}
