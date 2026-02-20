/*
  Generates lightweight procedural WAV files for referenced SFX ids.
  Output:
    assets/audio/generated/<sfxId>.wav
*/

const fs = require('fs');
const path = require('path');

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

function writeWav(fp, samples, sampleRate){
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample/8;
  const blockAlign = numChannels * bitsPerSample/8;
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  let o=0;
  buf.write('RIFF', o); o+=4;
  buf.writeUInt32LE(36 + dataSize, o); o+=4;
  buf.write('WAVE', o); o+=4;
  buf.write('fmt ', o); o+=4;
  buf.writeUInt32LE(16, o); o+=4; // PCM
  buf.writeUInt16LE(1, o); o+=2; // PCM
  buf.writeUInt16LE(numChannels, o); o+=2;
  buf.writeUInt32LE(sampleRate, o); o+=4;
  buf.writeUInt32LE(byteRate, o); o+=4;
  buf.writeUInt16LE(blockAlign, o); o+=2;
  buf.writeUInt16LE(bitsPerSample, o); o+=2;
  buf.write('data', o); o+=4;
  buf.writeUInt32LE(dataSize, o); o+=4;
  for (let i=0;i<samples.length;i++){
    buf.writeInt16LE(samples[i], o); o+=2;
  }
  fs.mkdirSync(path.dirname(fp), { recursive:true });
  fs.writeFileSync(fp, buf);
}

function makeBeep(id){
  const seed = hashStr('sfx:'+id);
  const rnd = mulberry32(seed);
  const sampleRate = 22050;
  const dur = 0.22 + rnd()*0.18;
  const n = Math.floor(sampleRate * dur);
  const f0 = 120 + rnd()*640;
  const f1 = f0 * (1.2 + rnd()*0.8);
  const samples = new Int16Array(n);
  for (let i=0;i<n;i++){
    const t = i / sampleRate;
    const f = f0 + (f1-f0) * (i/n);
    const env = Math.sin(Math.PI * (i/n));
    const s = Math.sin(2*Math.PI*f*t) * env;
    // slight grit
    const grit = (rnd()-0.5) * 0.08;
    const v = clamp(s + grit, -1, 1);
    samples[i] = Math.floor(v * 0.55 * 32767);
  }
  return { samples, sampleRate };
}

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

function main(){
  const wf = readJSON('data/weapon_families.json').weaponFamilies || [];
  const sfxIds = new Set();
  for (const w of wf){
    if (w?.sfx?.fire) sfxIds.add(w.sfx.fire);
    if (w?.sfx?.hit) sfxIds.add(w.sfx.hit);
  }
  // Common fallbacks
  ['sfx_ui_confirm','sfx_ui_back','sfx_enemy_hit','sfx_player_hit'].forEach(id=>sfxIds.add(id));

  const outDir = path.join(ROOT, 'assets/audio/generated');
  fs.mkdirSync(outDir, { recursive:true });
  let n=0;
  for (const id of Array.from(sfxIds).sort()){
    const fp = path.join(outDir, `${id}.wav`);
    if (fs.existsSync(fp)) continue;
    const { samples, sampleRate } = makeBeep(id);
    writeWav(fp, samples, sampleRate);
    n++;
  }
  console.log(`generateSfx: wrote ${n} wav(s) to assets/audio/generated/`);
}

main();
