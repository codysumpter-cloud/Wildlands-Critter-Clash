#!/usr/bin/env node
/* Bundle-only release packager for itch.io.
   Produces /release containing only what the embed needs. */

const fs = require('fs');
const path = require('path');

function rmrf(p){
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dst){
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(srcDir, dstDir){
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })){
    const s = path.join(srcDir, ent.name);
    const d = path.join(dstDir, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

function main(){
  const root = process.cwd();
  const out = path.join(root, 'release');
  rmrf(out);
  fs.mkdirSync(out, { recursive: true });

  // Core web entry
  for (const f of ['index.html', 'style.css', 'game_bundle.js', 'data_bundle.js']){
    if (!fs.existsSync(path.join(root, f))) throw new Error(`Missing required file: ${f}`);
    copyFile(path.join(root, f), path.join(out, f));
  }
  // Optional theme file
  if (fs.existsSync(path.join(root, 'wildlands_theme.css'))){
    copyFile(path.join(root, 'wildlands_theme.css'), path.join(out, 'wildlands_theme.css'));
  }

  // Runtime + assets
  copyDir(path.join(root, 'runtime'), path.join(out, 'runtime'));
  copyDir(path.join(root, 'assets'), path.join(out, 'assets'));

  // Net config (optional)
  copyDir(path.join(root, 'data', 'net'), path.join(out, 'data', 'net'));

  // Docs
  if (fs.existsSync(path.join(root, 'RELEASE_NOTES.md'))){
    copyFile(path.join(root, 'RELEASE_NOTES.md'), path.join(out, 'RELEASE_NOTES.md'));
  }

  console.log('Release folder built at:', out);
}

try{ main(); }
catch(e){
  console.error(String(e && (e.stack||e.message) || e));
  process.exit(1);
}
