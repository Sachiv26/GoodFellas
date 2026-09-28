// Dev utility: query the extracted text-position TSVs by coordinate band.
// usage: node scripts/query-tsv.mjs <page> <xmin> <xmax> <ymin> <ymax> [needle]
import * as fs from 'fs';

const [page, xmin, xmax, ymin, ymax, needle] = process.argv.slice(2);
const file = `tmp/page-${page}-text-positions.tsv`;
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
const rows = [];
for (const line of lines) {
  const f = line.split('\t');
  if (f.length < 3) continue;
  const x = Number(f[0]);
  const y = Number(f[1]);
  const text = f.slice(2).join('\t');
  if (Number.isNaN(x) || Number.isNaN(y)) continue;
  if (x < Number(xmin) || x > Number(xmax)) continue;
  if (y < Number(ymin) || y > Number(ymax)) continue;
  if (needle && !new RegExp(needle, 'i').test(text)) continue;
  rows.push({ x, y, text });
}
rows.sort((a, b) => b.y - a.y || a.x - b.x);
for (const r of rows) console.log(`${r.x.toFixed(2)}\t${r.y.toFixed(2)}\t${r.text}`);
