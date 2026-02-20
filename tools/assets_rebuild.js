#!/usr/bin/env node
/*
  assets_rebuild.js

  Single entrypoint for any asset regeneration / refresh.

  This project ships with pre-generated PNGs in assets/**.
  If external generators exist (Aseprite, pipeline tools), they should be invoked
  from THIS file only so the task surface stays minimal.

  Current behavior (non-destructive):
    - Ensures expected folders exist
    - Emits a concise warning list for missing “core” assets
*/

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

// --- Pixel Art Upgrade Engine (offline build-step) ---
// Bible-driven selection comes from runtime/registry.json (generated from the Bible import).
// Non-destructive rule:
//   - move original sprites to original_<filename>.png (same folder)
//   - write upgraded PNG back to the original filename (so runtime uses it)
// This uses ONLY project PNGs as source pixels.
//
// Disable by setting env: PIXEL_UPGRADE=0
const UPGRADE_ENABLED = process.env.PIXEL_UPGRADE !== '0';
if (UPGRADE_ENABLED) {
  const py = process.env.PYTHON || 'python3';
  const script = path.join(__dirname, 'pixel_upgrade.py');
  const registry = path.join(ROOT, 'runtime', 'registry.json');

  const run = (args, label) => {
    const r = spawnSync(py, args, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`[assets:rebuild] ${label} pixel upgrade step failed; continuing.`);
    }
  };

  if (fs.existsSync(script)) {
    // 1) Registry-driven tags (Bible-driven where present)
    if (fs.existsSync(registry)) {
      for (const tag of ['player', 'enemy', 'vfx', 'prop', 'attachment', 'icon', 'weaponFamily', 'ui', 'tile']) {
        run([script, '--registry', registry, '--tag', tag, '--prefix', 'original_'], `tag=${tag}`);
      }
    } else {
      console.warn('[assets:rebuild] Pixel upgrade (tag pass) skipped (missing runtime/registry.json).');
    }

    // 2) Folder-driven completeness (covers assets that may not be listed in registry yet)
    //    Still non-destructive and still uses only your pixels.
    const dirPass = [
      'assets/icons',
      'assets/props',
      'assets/vfx',
      'assets/weapons',
      'assets/attachments'
    ];
    run([script, '--dirs', dirPass.join(','), '--prefix', 'original_'], 'dir-scan');
  } else {
    console.warn('[assets:rebuild] Pixel upgrade step skipped (missing tools/pixel_upgrade.py).');
  }
}
const EXPECT_DIRS = [
  'generated/players',
  'generated/icons',
  'players',
  'icons',
  'enemies',
  'props',
  'vfx',
  'sfx',
  'bosses',
  'tiles'
];

for (const d of EXPECT_DIRS) {
  fs.mkdirSync(path.join(ASSETS, d), { recursive: true });
}

const mustHave = [
  path.join(ASSETS, 'grass.png'),
  path.join(ASSETS, 'projectile.png')
];

const missing = mustHave.filter(p => !fs.existsSync(p)).map(p => path.relative(ROOT, p));
if (missing.length) {
  console.warn(`[assets:rebuild] Missing core assets (continuing): ${missing.join(', ')}`);
}
