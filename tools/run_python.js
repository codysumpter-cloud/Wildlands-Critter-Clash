#!/usr/bin/env node
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('Usage: node tools/run_python.js <script.py> [args...]');
  process.exit(1);
}

const script = argv[0];
const scriptArgs = argv.slice(1);
const localPy = process.env.LOCALAPPDATA
  ? `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python311\\python.exe`
  : null;

const candidates = [
  ...(localPy ? [{ cmd: localPy, args: [script, ...scriptArgs] }] : []),
  { cmd: 'py', args: ['-3', script, ...scriptArgs] },
  { cmd: 'python3', args: [script, ...scriptArgs] },
  { cmd: 'python', args: [script, ...scriptArgs] }
];

for (const c of candidates) {
  const r = spawnSync(c.cmd, c.args, { stdio: 'inherit', shell: false });
  if (r.error) {
    if (r.error.code === 'ENOENT') continue;
    console.error(`Failed running ${c.cmd}: ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 0);
}

console.error('No Python interpreter found (tried: python3, python, py -3).');
console.error('Install Python 3 or use prebuilt runtime/release artifacts.');
process.exit(1);
