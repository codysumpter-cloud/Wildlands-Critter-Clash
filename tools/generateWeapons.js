/*
  Generates simple weapon sprites + icons for every weapon family referenced in data/weapon_families.json.

  Output:
    assets/generated/weapons/<weaponId>.png (32x32)
    assets/generated/weapons/<weaponId>_icon.png (16x16)
*/

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');

function readJSON(p){
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
}

function hashStr(s){
  let h = 2166136261 >>> 0;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

function drawWeapon(id, size){
  const seed = hashStr('weapon:'+id);
  const rnd = mulberry32(seed);
  const img = new PNG({ width:size, height:size });
  for (let i=0;i<img.data.length;i+=4) img.data[i+3]=0;

  const base = [
    70 + Math.floor(rnd()*140),
    70 + Math.floor(rnd()*140),
    70 + Math.floor(rnd()*140)
  ];
  const metal = [240, 235, 220];
  const dark = [22,22,26];
  const accent = [clamp(base[0]+60,0,255), clamp(base[1]+30,0,255), clamp(base[2]+10,0,255)];

  // blade/club body
  const cx = Math.floor(size*0.55);
  const cy = Math.floor(size*0.5);
  const len = Math.floor(size*0.55);
  const thick = Math.max(2, Math.floor(size*0.10));
  const angle = (-0.7 + rnd()*0.5);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  for (let t=-len;t<=len;t++){
    const x0 = Math.floor(cx + dx*t);
    const y0 = Math.floor(cy + dy*t);
    for (let o=-thick;o<=thick;o++){
      const x = x0 + Math.floor(-dy*o);
      const y = y0 + Math.floor(dx*o);
      if (x<0||y<0||x>=size||y>=size) continue;
      const i=(y*size+x)*4;
      img.data[i]=metal[0]; img.data[i+1]=metal[1]; img.data[i+2]=metal[2]; img.data[i+3]=255;
    }
  }
  // handle
  const hx = Math.floor(size*0.30);
  const hy = Math.floor(size*0.70);
  for (let t=0;t<Math.floor(size*0.35);t++){
    const x0 = Math.floor(hx + dx*t);
    const y0 = Math.floor(hy + dy*t);
    for (let o=-Math.max(1,Math.floor(thick*0.6)); o<=Math.max(1,Math.floor(thick*0.6)); o++){
      const x = x0 + Math.floor(-dy*o);
      const y = y0 + Math.floor(dx*o);
      if (x<0||y<0||x>=size||y>=size) continue;
      const i=(y*size+x)*4;
      img.data[i]=base[0]; img.data[i+1]=base[1]; img.data[i+2]=base[2]; img.data[i+3]=255;
    }
  }
  // gem/accent
  const gx = Math.floor(size*0.58);
  const gy = Math.floor(size*0.42);
  for (let y=gy-1;y<=gy+1;y++) for (let x=gx-1;x<=gx+1;x++){
    if (x<0||y<0||x>=size||y>=size) continue;
    const i=(y*size+x)*4;
    img.data[i]=accent[0]; img.data[i+1]=accent[1]; img.data[i+2]=accent[2]; img.data[i+3]=255;
  }
  // outline
  function isO(x,y){
    if (x<0||y<0||x>=size||y>=size) return false;
    return img.data[(y*size+x)*4+3] > 0;
  }
  for (let y=0;y<size;y++){
    for (let x=0;x<size;x++){
      if (!isO(x,y)) continue;
      const n = !isO(x-1,y)||!isO(x+1,y)||!isO(x,y-1)||!isO(x,y+1);
      if (n){
        const i=(y*size+x)*4;
        img.data[i]=dark[0]; img.data[i+1]=dark[1]; img.data[i+2]=dark[2]; img.data[i+3]=255;
      }
    }
  }
  return img;
}

function downsample(src, outSize){
  const dst = new PNG({ width:outSize, height:outSize });
  for (let i=0;i<dst.data.length;i+=4) dst.data[i+3]=0;
  const sx = src.width / outSize;
  const sy = src.height / outSize;
  for (let y=0;y<outSize;y++){
    for (let x=0;x<outSize;x++){
      const ix = Math.floor((x+0.5)*sx);
      const iy = Math.floor((y+0.5)*sy);
      const si=(iy*src.width+ix)*4;
      const di=(y*outSize+x)*4;
      dst.data[di]=src.data[si];
      dst.data[di+1]=src.data[si+1];
      dst.data[di+2]=src.data[si+2];
      dst.data[di+3]=src.data[si+3];
    }
  }
  return dst;
}

function main(){
  const wf = readJSON('data/weapon_families.json').weaponFamilies || [];
  const outDir = path.join(ROOT, 'assets/generated/weapons');
  fs.mkdirSync(outDir, { recursive:true });
  let n=0;
  for (const w of wf){
    const id = w.id;
    if (!id) continue;
    const sprite = drawWeapon(id, 32);
    const icon = downsample(sprite, 16);
    fs.writeFileSync(path.join(outDir, `${id}.png`), PNG.sync.write(sprite));
    fs.writeFileSync(path.join(outDir, `${id}_icon.png`), PNG.sync.write(icon));
    n++;
  }
  console.log(`generateWeapons: wrote ${n} weapons`);
}

main();
