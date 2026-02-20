/*
  Generates minimal readable VFX sheets for referenced VFX ids.
  Output:
    assets/generated/vfx/<vfxId>.png  (4 frames, 16x16 each => 64x16)
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

function setPx(img,x,y,r,g,b,a){
  if (x<0||y<0||x>=img.width||y>=img.height) return;
  const i=(y*img.width+x)*4;
  img.data[i]=r; img.data[i+1]=g; img.data[i+2]=b; img.data[i+3]=a;
}

function drawFrame(img, ox, oy, seed, f){
  const rnd = mulberry32(seed + f*1337);
  const core = [
    120 + Math.floor(rnd()*120),
    80 + Math.floor(rnd()*140),
    60 + Math.floor(rnd()*160)
  ];
  const dark = [24,24,28];
  // starburst + shards
  const cx=ox+8, cy=oy+8;
  for (let k=0;k<18;k++){
    const ang = (k/18)*Math.PI*2 + (rnd()-0.5)*0.3;
    const len = 3 + Math.floor(rnd()*5) + f;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let t=0;t<len;t++){
      const x = Math.floor(cx + dx*t);
      const y = Math.floor(cy + dy*t);
      const a = 255 - t*25;
      setPx(img, x, y, core[0], core[1], core[2], clamp(a,0,255));
    }
  }
  // outline edge darkening
  for (let y=oy;y<oy+16;y++){
    for (let x=ox;x<ox+16;x++){
      const i=(y*img.width+x)*4;
      const a=img.data[i+3];
      if (!a) continue;
      // if neighbor empty, make edge dark
      const nn = [[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dx,dy] of nn){
        const nx=x+dx, ny=y+dy;
        const ni=(ny*img.width+nx)*4;
        if (nx<ox||nx>=ox+16||ny<oy||ny>=oy+16 || img.data[ni+3]===0){
          img.data[i]=dark[0]; img.data[i+1]=dark[1]; img.data[i+2]=dark[2]; img.data[i+3]=255;
          break;
        }
      }
    }
  }
}

function main(){
  const wf = readJSON('data/weapon_families.json').weaponFamilies || [];
  const vfxIds = new Set();
  for (const w of wf){
    if (w?.vfx?.muzzle) vfxIds.add(w.vfx.muzzle);
    if (w?.vfx?.hit) vfxIds.add(w.vfx.hit);
  }
  // common ids if referenced elsewhere
  ['vfx_projectile_trail','vfx_melee_arc','vfx_impact','vfx_muzzle','vfx_hit'].forEach(id=>vfxIds.add(id));

  const outDir = path.join(ROOT, 'assets/generated/vfx');
  fs.mkdirSync(outDir, { recursive:true });
  let n=0;
  for (const id of Array.from(vfxIds).sort()){
    const seed = hashStr('vfx:'+id);
    const img = new PNG({ width:64, height:16 });
    for (let i=0;i<img.data.length;i+=4) img.data[i+3]=0;
    for (let f=0;f<4;f++) drawFrame(img, f*16, 0, seed, f);
    fs.writeFileSync(path.join(outDir, `${id}.png`), PNG.sync.write(img));
    n++;
  }
  console.log(`generateVfx: wrote ${n} vfx sheets`);
}

main();
