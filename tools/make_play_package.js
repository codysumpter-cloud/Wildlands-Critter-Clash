#!/usr/bin/env node
/* Build a no-Python, plug-and-play package for players/testers. */
const fs = require('fs');
const path = require('path');

function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
function ensure(p) { fs.mkdirSync(p, { recursive: true }); }
function copyFile(src, dst) { ensure(path.dirname(dst)); fs.copyFileSync(src, dst); }
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  ensure(dst);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d); else copyFile(s, d);
  }
}

function must(root, rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) throw new Error(`Missing required file/folder: ${rel}`);
  return p;
}

function main() {
  const root = process.cwd();
  const out = path.join(root, 'out', 'play-no-python');
  rmrf(out);
  ensure(out);

  const releaseDir = path.join(root, 'release');
  let useRelease = false;
  if (fs.existsSync(path.join(releaseDir, 'game_bundle.js')) && fs.existsSync(path.join(releaseDir, 'runtime'))) {
    const gb = fs.readFileSync(path.join(releaseDir, 'game_bundle.js'), 'utf8');
    // Guard against stale/incomplete bundles in release/.
    useRelease = gb.includes('function updateWeapons(');
  }

  // Required runtime files (already built artifacts)
  const requiredRoot = ['PLAY_WILDLANDS.html', 'PLAY_WILDLANDS_WINDOWS.bat', 'README_PLUG_AND_PLAY.txt'];
  requiredRoot.forEach((r) => must(root, r));

  const requiredRuntime = ['index.html', 'style.css', 'game_bundle.js', 'data_bundle.js', 'runtime', 'assets'];
  requiredRuntime.forEach((r) => must(useRelease ? releaseDir : root, r));

  // Core files
  for (const f of ['PLAY_WILDLANDS.html', 'PLAY_WILDLANDS_WINDOWS.bat', 'README_PLUG_AND_PLAY.txt']) {
    copyFile(path.join(root, f), path.join(out, f));
  }
  for (const f of ['index.html', 'style.css', 'game_bundle.js', 'data_bundle.js']) {
    copyFile(path.join(useRelease ? releaseDir : root, f), path.join(out, f));
  }

  // Optional convenience launchers/themes
  for (const f of ['PLAY_WILDLANDS_MAC.command', 'wildlands_theme.css']) {
    if (fs.existsSync(path.join(root, f))) copyFile(path.join(root, f), path.join(out, f));
  }

  // Runtime content
  copyDir(path.join(useRelease ? releaseDir : root, 'runtime'), path.join(out, 'runtime'));
  copyDir(path.join(useRelease ? releaseDir : root, 'assets'), path.join(out, 'assets'));

  // Optional net configs/docs
  copyDir(path.join(useRelease ? releaseDir : root, 'data', 'net'), path.join(out, 'data', 'net'));
  if (fs.existsSync(path.join(root, 'RELEASE_NOTES.md'))) {
    copyFile(path.join(root, 'RELEASE_NOTES.md'), path.join(out, 'RELEASE_NOTES.md'));
  }

  console.log('No-Python play package created at:', out);
}

try { main(); }
catch (e) {
  console.error(String((e && (e.stack || e.message)) || e));
  process.exit(1);
}
