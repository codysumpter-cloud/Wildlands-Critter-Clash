#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const srcDir = path.join(root, 'out', 'play-no-python');
const zipPath = path.join(root, 'out', 'play-no-python.zip');

if (!fs.existsSync(srcDir)) {
  console.error('Missing out/play-no-python. Run: npm run play:pack');
  process.exit(1);
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

if (process.platform === 'win32') {
  const psCmd = `Compress-Archive -Path "${srcDir}\\*" -DestinationPath "${zipPath}" -Force`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', psCmd], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const r = spawnSync('zip', ['-r', zipPath, '.'], { cwd: srcDir, stdio: 'inherit' });
if (r.error) {
  console.error('Could not create zip (missing `zip` command).');
  process.exit(1);
}
process.exit(r.status ?? 1);
