/*
  Generates creature-themed mutation parts sheets (simple procedural pixel art).
  Output:
    assets/generated/creatures/<creatureId>/parts_sheet.png

  Layout: 6 cells in a single row, each 32x32
    0 HEAD
    1 HEAD_SIDE
    2 BODY
    3 BACK
    4 WEAPON
    5 AURA

  This is NOT a final art solution, but it guarantees:
   - non-primitive silhouettes (no circles/squares)
   - >= 12 colors used
   - stable output (seeded)
*/

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');

function readJSON(p){
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
}

function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s){
  let h = 2166136261 >>> 0;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

function rgba(r,g,b,a=255){ return {r,g,b,a}; }

function makePalette(seed){
  const rnd = mulberry32(seed);
  // 4 base hues with shifts -> 12+ distinct colors
  const base = [];
  for (let i=0;i<4;i++){
    const r = Math.floor(60 + rnd()*140);
    const g = Math.floor(60 + rnd()*140);
    const b = Math.floor(60 + rnd()*140);
    base.push([r,g,b]);
  }
  const pal = [];
  for (const [r,g,b] of base){
    pal.push([r,g,b]);
    pal.push([clamp(r+40,0,255), clamp(g+40,0,255), clamp(b+40,0,255)]);
    pal.push([clamp(r-40,0,255), clamp(g-40,0,255), clamp(b-40,0,255)]);
  }
  // outline
  pal.push([20,20,24]);
  pal.push([240,235,225]);
  return pal;
}

function drawPart(cell, seed, kind){
  const size = 32;
  const rnd = mulberry32(seed);
  const pal = makePalette(seed);
  const img = new PNG({ width:size, height:size });

  // background transparent
  for (let i=0;i<img.data.length;i+=4) img.data[i+3]=0;

  // Build a lumpy silhouette via random walk + fill
  const cx = 16 + Math.floor((rnd()-0.5)*4);
  const cy = 16 + Math.floor((rnd()-0.5)*4);
  const r0 = 8 + Math.floor(rnd()*4);
  const pts = [];
  const spikes = (kind==='HEAD_SIDE' || kind==='BACK') ? 6 : 3;
  for (let i=0;i<12;i++){
    const ang = (i/12)*Math.PI*2;
    let rr = r0 + (rnd()-0.5)*3;
    if (i%4===0) rr += rnd()*spikes;
    pts.push([cx + Math.cos(ang)*rr, cy + Math.sin(ang)*rr]);
  }

  function inside(x,y){
    // winding-ish via ray casting
    let c=false;
    for (let i=0,j=pts.length-1;i<pts.length;j=i++){
      const xi=pts[i][0], yi=pts[i][1];
      const xj=pts[j][0], yj=pts[j][1];
      const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+1e-6)+xi);
      if (intersect) c=!c;
    }
    return c;
  }

  // Fill body
  for (let y=0;y<size;y++){
    for (let x=0;x<size;x++){
      if (!inside(x+0.5,y+0.5)) continue;
      // internal shading bands
      const t = (x+y) / (2*size);
      const idx = Math.floor(t*10) % (pal.length-2);
      const [r,g,b] = pal[idx];
      const i = (y*size+x)*4;
      img.data[i]=r; img.data[i+1]=g; img.data[i+2]=b; img.data[i+3]=255;
    }
  }

  // Add accents per kind
  const accent = pal[pal.length-2];
  if (kind==='AURA'){
    for (let k=0;k<120;k++){
      const x = Math.floor(rnd()*size);
      const y = Math.floor(rnd()*size);
      const i = (y*size+x)*4;
      if (img.data[i+3]===0) {
        img.data[i]=accent[0]; img.data[i+1]=accent[1]; img.data[i+2]=accent[2]; img.data[i+3]=120;
      }
    }
  }
  if (kind==='WEAPON'){
    const ax = 8+Math.floor(rnd()*8);
    const ay = 10+Math.floor(rnd()*10);
    for (let y=ay;y<ay+3;y++) for (let x=ax;x<ax+14;x++){
      const i=(y*size+x)*4;
      img.data[i]=240; img.data[i+1]=230; img.data[i+2]=180; img.data[i+3]=255;
    }
    for (let y=ay-6;y<ay;y++) for (let x=ax+10;x<ax+13;x++){
      const i=(y*size+x)*4;
      img.data[i]=accent[0]; img.data[i+1]=accent[1]; img.data[i+2]=accent[2]; img.data[i+3]=255;
    }
  }

  // Outline pass (1px) using dark outline color
  const ol = pal[pal.length-3];
  function isOpaque(x,y){
    if (x<0||y<0||x>=size||y>=size) return false;
    return img.data[(y*size+x)*4+3] > 0;
  }
  for (let y=0;y<size;y++){
    for (let x=0;x<size;x++){
      if (!isOpaque(x,y)) continue;
      const n = !isOpaque(x-1,y)||!isOpaque(x+1,y)||!isOpaque(x,y-1)||!isOpaque(x,y+1);
      if (n){
        const i=(y*size+x)*4;
        img.data[i]=ol[0]; img.data[i+1]=ol[1]; img.data[i+2]=ol[2]; img.data[i+3]=255;
      }
    }
  }
  return img;
}

function blit(dst, src, ox, oy){
  for (let y=0;y<src.height;y++){
    for (let x=0;x<src.width;x++){
      const si=(y*src.width+x)*4;
      const a=src.data[si+3];
      if (!a) continue;
      const dx=ox+x, dy=oy+y;
      const di=(dy*dst.width+dx)*4;
      dst.data[di]=src.data[si];
      dst.data[di+1]=src.data[si+1];
      dst.data[di+2]=src.data[si+2];
      dst.data[di+3]=a;
    }
  }
}

function main(){
  const creatures = readJSON('data/creatures.json').creatures || [];
  const outRoot = path.join(ROOT, 'assets/generated/creatures');
  fs.mkdirSync(outRoot, { recursive:true });

  const slots = ['HEAD','HEAD_SIDE','BODY','BACK','WEAPON','AURA'];
  let n=0;
  for (const c of creatures){
    const id = c.id;
    if (!id) continue;
    const dir = path.join(outRoot, id);
    fs.mkdirSync(dir, { recursive:true });

    const sheet = new PNG({ width: 32*slots.length, height: 32 });
    for (let i=0;i<sheet.data.length;i+=4) sheet.data[i+3]=0;
    for (let i=0;i<slots.length;i++){
      const seed = hashStr(`${id}:${slots[i]}`);
      const part = drawPart(i, seed, slots[i]);
      blit(sheet, part, i*32, 0);
    }
    const fp = path.join(dir, 'parts_sheet.png');
    fs.writeFileSync(fp, PNG.sync.write(sheet));
    n++;
  }
  console.log(`generateMutationParts: wrote parts_sheet.png for ${n} creature(s)`);
}

main();
