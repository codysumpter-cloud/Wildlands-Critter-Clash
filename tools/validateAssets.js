/*
  Web-safe placeholder detector for PNG assets.

  Heuristics (fail if any triggered):
  - unique color count < 12
  - >=70% of opaque pixels are a single color
  - low edge score (flat / no contrast)
  - large perfect-rectangle coverage (AABB fill)
  - repeated identical hash across many assets

  Output: one line per bad asset: "FAIL <reasonCodes> <path>"
  Exit code:
    - 0 if no failures
    - 2 if failures
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = [
  'assets/generated',
  'assets/weapons',
  'assets/vfx',
  'assets/creatures',
  'assets/props'
].map(p => path.join(ROOT, p));

function* walk(dir){
  if (!fs.existsSync(dir)) return;
  const st = fs.statSync(dir);
  if (!st.isDirectory()) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function readPng(fp){
  const buf = fs.readFileSync(fp);
  return PNG.sync.read(buf);
}

function lum(r,g,b){
  return 0.2126*r + 0.7152*g + 0.0722*b;
}

function analyze(png){
  const { width:w, height:h, data } = png;
  let opaque = 0;
  const colorCounts = new Map(); // rgb packed
  let minX=w, minY=h, maxX=-1, maxY=-1;
  let edgeScore = 0;
  let lastRowLum = new Float32Array(w);
  let curRowLum = new Float32Array(w);

  // Pass 1: stats + bbox
  for (let y=0;y<h;y++){
    for (let x=0;x<w;x++){
      const i = (y*w + x) * 4;
      const a = data[i+3];
      if (a < 16) { curRowLum[x] = 0; continue; }
      const r = data[i], g = data[i+1], b = data[i+2];
      const key = (r<<16) | (g<<8) | b;
      colorCounts.set(key, (colorCounts.get(key)||0) + 1);
      opaque++;
      if (x<minX) minX=x; if (y<minY) minY=y;
      if (x>maxX) maxX=x; if (y>maxY) maxY=y;
      curRowLum[x] = lum(r,g,b);
    }
    // simple edge: sum abs diff horizontally + vertically
    for (let x=1;x<w;x++) edgeScore += Math.abs(curRowLum[x] - curRowLum[x-1]);
    for (let x=0;x<w;x++) edgeScore += Math.abs(curRowLum[x] - lastRowLum[x]);
    const tmp = lastRowLum; lastRowLum = curRowLum; curRowLum = tmp;
  }

  const uniqueColors = colorCounts.size;
  let topColorPct = 0;
  if (opaque > 0) {
    let top = 0;
    for (const c of colorCounts.values()) if (c>top) top=c;
    topColorPct = top / opaque;
  }

  const bboxArea = (maxX>=minX && maxY>=minY) ? (maxX-minX+1) * (maxY-minY+1) : 0;
  const bboxFillPct = (bboxArea>0) ? (opaque / bboxArea) : 0;

  // Normalize edge score by opaque pixels (avoid penalizing transparency)
  const normEdge = (opaque>0) ? (edgeScore / opaque) : 0;

  return { uniqueColors, topColorPct, normEdge, bboxFillPct, opaque, w, h };
}

function hashFile(fp){
  const buf = fs.readFileSync(fp);
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function rel(fp){
  return path.relative(ROOT, fp).replace(/\\/g,'/');
}

const findings = [];
const hashToPaths = new Map();

for (const dir of SCAN_DIRS) {
  for (const fp of walk(dir)) {
    if (!fp.toLowerCase().endsWith('.png')) continue;
    let png;
    try { png = readPng(fp); } catch (e) {
      findings.push({ fp, reasons: ['bad_png'] });
      continue;
    }
    const a = analyze(png);
    const reasons = [];
    if (a.opaque > 16) {
      if (a.uniqueColors < 12) reasons.push('low_colors');
      if (a.topColorPct >= 0.70) reasons.push('dominant_color');
      if (a.normEdge < 3.0) reasons.push('low_edges');
      // Perfect rectangle-ish: opaque mostly fills its bounding box
      if (a.bboxFillPct >= 0.92) reasons.push('rect_fill');
    }
    const h = hashFile(fp);
    const list = hashToPaths.get(h) || [];
    list.push(fp);
    hashToPaths.set(h, list);

    if (reasons.length) findings.push({ fp, reasons });
  }
}

// repeated identical hash across many ids
for (const [h, paths] of hashToPaths.entries()) {
  if (paths.length >= 8) {
    for (const fp of paths) {
      findings.push({ fp, reasons: ['repeated_hash'] });
    }
  }
}

// Dedup reasons per file
const byFile = new Map();
for (const f of findings) {
  const k = f.fp;
  const cur = byFile.get(k) || new Set();
  for (const r of f.reasons) cur.add(r);
  byFile.set(k, cur);
}

const out = [];
for (const [fp, rs] of byFile.entries()) {
  out.push({ fp, reasons: Array.from(rs).sort() });
}
out.sort((a,b)=>a.fp.localeCompare(b.fp));

let failCount = 0;
for (const f of out) {
  failCount++;
  console.log(`FAIL ${f.reasons.join(',')} ${rel(f.fp)}`);
}

if (failCount) {
  console.error(`\nvalidateAssets: ${failCount} asset(s) flagged as placeholder-like.`);
  process.exit(2);
}
console.log('validateAssets: OK');
