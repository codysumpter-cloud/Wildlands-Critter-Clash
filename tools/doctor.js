#!/usr/bin/env node
const fs = require('fs');

const required = [
  'tools/bible_import_optional.py',
  'tools/build_runtime.js',
  'Wildlands_Data_Bible_v15_newbuild_phase2_full_extraction.xlsx',
  'data',
  'runtime'
];

const missing = required.filter((p) => !fs.existsSync(p));
if (missing.length) {
  console.error('Doctor check failed. Missing required paths:');
  for (const p of missing) console.error(` - ${p}`);
  process.exit(1);
}

console.log('Doctor check passed.');
