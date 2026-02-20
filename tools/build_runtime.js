#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const generatedDir = path.resolve('data/generated');
const runtimeDir = path.resolve('runtime');

if (!fs.existsSync(generatedDir)) {
  console.error('[build_runtime] missing data/generated directory');
  process.exit(1);
}

fs.mkdirSync(runtimeDir, { recursive: true });

const manifestPath = path.join(generatedDir, 'manifest.json');
const corePath = path.join(generatedDir, 'core_data.json');

if (!fs.existsSync(manifestPath) || !fs.existsSync(corePath)) {
  console.error('[build_runtime] expected manifest.json and core_data.json from bible_import');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const core = JSON.parse(fs.readFileSync(corePath, 'utf8'));

const runtimeManifest = {
  ...manifest,
  runtimeVersion: 'v16-runtime',
  deterministic: true
};

fs.writeFileSync(path.join(runtimeDir, 'manifest.json'), JSON.stringify(runtimeManifest, null, 2) + '\n');
fs.writeFileSync(path.join(runtimeDir, 'weapons.json'), JSON.stringify(core.weapons || [], null, 2) + '\n');
fs.writeFileSync(path.join(runtimeDir, 'damage_types.json'), JSON.stringify(core.damage_types || [], null, 2) + '\n');
fs.writeFileSync(path.join(runtimeDir, 'status_effects.json'), JSON.stringify(core.status_effects || [], null, 2) + '\n');

console.log('[build_runtime] runtime files generated');
