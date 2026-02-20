#!/usr/bin/env node
/*
  build_runtime.js
  Deterministically regenerates:
    - runtime/manifest.json
    - runtime/registry.json
    - runtime/content.json
    - runtime/content_launch.json
    - runtime/content_experimental.json
    - runtime/validation_report.json

  Source of truth:
    - data/*.json (compiled exports)
    - data/bible_v9/SlotContracts.json (slot caps/order)
    - assets/** (asset scan)

  Determinism rules:
    - Stable ordering
    - No timestamps
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets');
const DATA_DIR = path.join(ROOT, 'data');
const GEN_DIR = path.join(DATA_DIR, 'generated');
const RUNTIME_DIR = path.join(ROOT, 'runtime');

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJSON(p, obj) {
  const stable = stableSort(obj);
  const txt = JSON.stringify(stable, null, 2) + '\n';
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, txt, 'utf8');
}

function stableSort(v) {
  if (Array.isArray(v)) {
    // If array of objects with id, sort by id for determinism.
    if (v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x) && 'id' in x)) {
      return v.map(stableSort).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }
    return v.map(stableSort);
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = stableSort(v[k]);
    return out;
  }
  return v;
}

function listFilesRecursive(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const ents = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of ents) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out;
}

function isPng(p) { return p.toLowerCase().endsWith('.png'); }

function pngSize(filePath) {
  // Parse IHDR chunk to get width/height
  const b = fs.readFileSync(filePath);
  // PNG signature is 8 bytes, then 4 length, 4 type, then IHDR data
  // width at byte 16..19, height at 20..23
  if (b.length < 24) return { w: 0, h: 0 };
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  return { w, h };
}

function relPosix(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function assertNoForbiddenId(obj, where) {
  const FORBIDDEN = 'spore' + 'sling';
  const s = JSON.stringify(obj);
  if (s.includes(FORBIDDEN)) {
    throw new Error(`Found forbidden creatureId token in `);
  }
}

function buildRegistry({ creatures }) {
  const assets = [];

  // Core
  for (const coreName of ['grass', 'projectile']) {
    const p = path.join(ASSETS_DIR, `${coreName}.png`);
    if (fs.existsSync(p)) {
      const { w, h } = pngSize(p);
      assets.push({
        id: `core.${coreName}`,
        type: 'image',
        path: relPosix(p),
        meta: { w, h },
        tags: ['core', 'launch']
      });
    }
  }

  // Players
  for (const c of creatures) {
    const id = c.id;
    // Prefer Bible-authored generated paths when present; fall back to legacy layout.
    const sheetRel = (c.alphaSpriteSheetPath && String(c.alphaSpriteSheetPath).startsWith('assets/'))
      ? String(c.alphaSpriteSheetPath).replace(/^assets\//, '')
      : path.posix.join('players', `${id}_sheet.png`);
    const iconRel = (c.alphaIconPath && String(c.alphaIconPath).startsWith('assets/'))
      ? String(c.alphaIconPath).replace(/^assets\//, '')
      : path.posix.join('icons', `${id}.png`);

    const sheet = path.join(ASSETS_DIR, ...sheetRel.split('/'));
    const icon = path.join(ASSETS_DIR, ...iconRel.split('/'));
    if (fs.existsSync(sheet)) {
      const { w, h } = pngSize(sheet);
      const cellW = 96;
      const cellH = 96;
      const cols = (w % cellW === 0) ? (w / cellW) : 6;
      const rows = (h % cellH === 0) ? (h / cellH) : Math.max(1, Math.round(h / cellH));
      assets.push({
        id: `player.${id}.sheet`,
        type: 'spritesheet',
        path: relPosix(sheet),
        meta: { w, h, cellW, cellH, cols, rows },
        tags: ['player', c.isLaunch ? 'launch' : 'experimental']
      });
    }
    if (fs.existsSync(icon)) {
      const { w, h } = pngSize(icon);
      assets.push({
        id: `player.${id}.icon`,
        type: 'icon',
        path: relPosix(icon),
        meta: { w, h },
        tags: ['player', 'icon', c.isLaunch ? 'launch' : 'experimental']
      });
    }
  }

  // Enemies
  // Enemy sprite sheets are 64x64 grid by default (e.g., 384x320 = 6 cols x 5 rows).
  // IMPORTANT: do NOT infer enemy cell sizes from boss sheets.
  const enemyDir = path.join(ASSETS_DIR, 'enemies');
  if (fs.existsSync(enemyDir)) {
    for (const p of fs.readdirSync(enemyDir).map(n => path.join(enemyDir, n)).filter(isPng)) {
      const base = path.basename(p, '.png');
      const { w, h } = pngSize(p);

      // Default enemy cell size
      let cellW = 64;
      let cellH = 64;

      // If an enemy sheet isn't divisible by 64, fall back to the largest square-ish divisor <= 96.
      // This keeps behavior deterministic while avoiding accidental global propagation.
      if (w % cellW !== 0 || h % cellH !== 0) {
        const candidates = [96, 80, 64, 48, 40, 32, 24, 20, 16, 12, 10, 8];
        let found = null;
        for (const c of candidates) {
          if (w % c === 0 && h % c === 0) { found = c; break; }
        }
        if (found) { cellW = found; cellH = found; }
      }

      const cols = Math.max(1, Math.floor(w / cellW));
      const rows = Math.max(1, Math.floor(h / cellH));

      assets.push({
        id: `enemy.${base}.sheet`,
        type: 'spritesheet',
        path: relPosix(p),
        meta: { w, h, cellW, cellH, cols, rows },
        tags: ['enemy', 'launch']
      });
    }
  }

  // Props
  const propsDir = path.join(ASSETS_DIR, 'props');
  if (fs.existsSync(propsDir)) {
    for (const p of fs.readdirSync(propsDir).map(n => path.join(propsDir, n)).filter(isPng)) {
      const base = path.basename(p, '.png');
      const { w, h } = pngSize(p);
      assets.push({
        id: `prop.${base}.image`,
        type: 'image',
        path: relPosix(p),
        meta: { w, h },
        tags: ['prop', 'launch']
      });
    }
  }

  // VFX
  const vfxDir = path.join(ASSETS_DIR, 'vfx');
  if (fs.existsSync(vfxDir)) {
    for (const p of fs.readdirSync(vfxDir).map(n => path.join(vfxDir, n)).filter(isPng)) {
      const base = path.basename(p, '.png');
      const { w, h } = pngSize(p);
      assets.push({
        id: `vfx.${base}.sprite`,
        type: 'image',
        path: relPosix(p),
        meta: { w, h },
        tags: ['vfx', 'launch']
      });
    }
  }

  // Bosses (spritesheets) - prototype parity
  // Prototype boss sheets use 96x64 cells (8 cols x 10 rows at 768x640)
  const bossesDir = path.join(ASSETS_DIR, 'bosses');
  if (fs.existsSync(bossesDir)) {
    for (const p of fs.readdirSync(bossesDir).map(n => path.join(bossesDir, n)).filter(isPng)) {
      const base = path.basename(p, '.png');
      const { w, h } = pngSize(p);
      const cellW = 96;
      const cellH = 64;
      const cols = (w % cellW === 0) ? (w / cellW) : undefined;
      const rows = (h % cellH === 0) ? (h / cellH) : undefined;
      assets.push({
        id: `boss.${base}.sheet`,
        type: 'spritesheet',
        path: relPosix(p),
        meta: { w, h, cellW, cellH, cols, rows },
        tags: ['boss', 'experimental']
      });
    }
  }

  // Tiles
  const tilesDir = path.join(ASSETS_DIR, 'tiles');
  if (fs.existsSync(tilesDir)) {
    for (const p of fs.readdirSync(tilesDir).map(n => path.join(tilesDir, n)).filter(isPng)) {
      const base = path.basename(p, '.png');
      const { w, h } = pngSize(p);
      assets.push({
        id: `tile.${base}.image`,
        type: 'image',
        path: relPosix(p),
        meta: { w, h },
        tags: ['tile', 'experimental']
      });
    }
  }

  // Items / Pickups / Orbitals / Projectiles / UI (prototype parity)
  function scanImageDir({ dirName, idPrefix, tags }) {
    const dir = path.join(ASSETS_DIR, dirName);
    if (!fs.existsSync(dir)) return;
    for (const p of fs.readdirSync(dir).map(n => path.join(dir, n)).filter(isPng)) {
      const base = path.basename(p, '.png');
      const { w, h } = pngSize(p);
      assets.push({
        id: `${idPrefix}.${base}.image`,
        type: 'image',
        path: relPosix(p),
        meta: { w, h },
        tags
      });
    }
  }

  scanImageDir({ dirName: 'items', idPrefix: 'item', tags: ['item', 'experimental'] });
  scanImageDir({ dirName: 'pickup', idPrefix: 'pickup', tags: ['pickup', 'experimental'] });
  scanImageDir({ dirName: 'orbital', idPrefix: 'orbital', tags: ['orbital', 'experimental'] });
  scanImageDir({ dirName: 'projectiles', idPrefix: 'projectile', tags: ['projectile', 'experimental'] });
  scanImageDir({ dirName: 'ui', idPrefix: 'ui', tags: ['ui', 'experimental'] });

  // Audio (SFX)
  const audioDir = path.join(ASSETS_DIR, 'audio');
  if (fs.existsSync(audioDir)) {
    const exts = new Set(['.wav', '.ogg', '.mp3']);
    for (const p of fs.readdirSync(audioDir).map(n => path.join(audioDir, n))) {
      if (!exts.has(path.extname(p).toLowerCase())) continue;
      const base = path.basename(p, path.extname(p));
      assets.push({
        id: `sfx.${base}`,
        type: 'audio',
        path: relPosix(p),
        meta: { ext: path.extname(p).toLowerCase().slice(1) },
        tags: ['sfx', 'experimental']
      });
    }
  }

  // Weapons (family icons)
  const weaponsDir = path.join(ASSETS_DIR, 'weapons');
  if (fs.existsSync(weaponsDir)) {
    for (const p of fs.readdirSync(weaponsDir).map(n => path.join(weaponsDir, n)).filter(isPng)) {
      const base = path.basename(p, '.png');
      const { w, h } = pngSize(p);
      assets.push({
        id: `weaponFamily.${base}.icon`,
        type: 'icon',
        path: relPosix(p),
        meta: { w, h },
        tags: ['weaponFamily', 'launch']
      });
    }
  }

  // Attachments (including subfolders)
  const attDir = path.join(ASSETS_DIR, 'attachments');
  if (fs.existsSync(attDir)) {
    const files = listFilesRecursive(attDir).filter(isPng);
    for (const p of files) {
      const rel = path.relative(attDir, p).split(path.sep).join('/');
      const key = rel.replace(/\.png$/i, '');
      const { w, h } = pngSize(p);
      assets.push({
        id: `attachment.${key}.sprite`,
        type: 'image',
        path: relPosix(p),
        meta: { w, h },
        tags: ['attachment', 'experimental']
      });
    }
  }

  // No aliases by default (aliases are a temporary crutch)
  const registry = {
    schemaVersion: 1,
    aliases: {},
    assets
  };

  assertNoForbiddenId(registry, 'registry');
  return registry;
}

function buildManifest({ registry, launchCreatureIds }) {
  const ids = registry.assets.map(a => a.id);
  const byId = new Map(registry.assets.map(a => [a.id, a]));

  // Preload core + launch players + all enemies + props + weaponFamily + common vfx
  const preloadLaunch = [];
  for (const core of ['core.grass', 'core.projectile']) if (byId.has(core)) preloadLaunch.push(core);

  for (const cid of launchCreatureIds) {
    preloadLaunch.push(`player.${cid}.icon`);
    preloadLaunch.push(`player.${cid}.sheet`);
  }

  for (const id of ids) {
    const a = byId.get(id);
    if (!a) continue;
    if (a.tags?.includes('enemy') || a.tags?.includes('prop') || a.tags?.includes('weaponFamily') || (a.tags?.includes('vfx') && a.id.startsWith('vfx.'))) {
      preloadLaunch.push(id);
    }
  }

  const manifest = {
    schemaVersion: 1,
    preload: {
      launch: Array.from(new Set(preloadLaunch)).sort(),
      experimental: registry.assets.filter(a => a.tags?.includes('experimental')).map(a => a.id).sort()
    }
  };

  assertNoForbiddenId(manifest, 'manifest');
  return manifest;
}

function buildContent() {
  // Prefer Bible-generated exports; fall back to legacy data/*.json to remain non-destructive.
  const creatures = (fs.existsSync(path.join(GEN_DIR, 'creatures.json'))
    ? readJSON(path.join(GEN_DIR, 'creatures.json'))
    : readJSON(path.join(DATA_DIR, 'creatures.json'))).creatures || [];

  const mutations = (fs.existsSync(path.join(GEN_DIR, 'evolution', 'modules.json'))
    ? { mutations: (readJSON(path.join(GEN_DIR, 'evolution', 'modules.json')).modules || []).map(m => ({
      id: m.id || m.moduleId,
      displayName: m.displayName || m.name || m.id || m.moduleId,
      rarity: m.rarity || 'common',
      // Keep any extra fields for forward-compat
      ...m
    })) }
    : readJSON(path.join(DATA_DIR, 'mutations.json'))).mutations || [];

  const stages = (fs.existsSync(path.join(GEN_DIR, 'stages.json'))
    ? readJSON(path.join(GEN_DIR, 'stages.json'))
    : readJSON(path.join(DATA_DIR, 'stages.json'))).stages || [];

  const weaponFamilies = (fs.existsSync(path.join(GEN_DIR, 'weapon_families.json'))
    ? readJSON(path.join(GEN_DIR, 'weapon_families.json'))
    : readJSON(path.join(DATA_DIR, 'weapon_families.json'))).weaponFamilies || [];

  // Slot contracts from bible export
  let slotContracts = {};
  const scPath = path.join(DATA_DIR, 'bible_v9', 'SlotContracts.json');
  if (fs.existsSync(scPath)) {
    const sc = readJSON(scPath);
    // Typically {slotContracts:{...}} or direct mapping
    slotContracts = sc.slotContracts || sc;
  }

  // Evolution graph (optional)
  const evoPath = fs.existsSync(path.join(GEN_DIR, 'evolution', 'nodes.json'))
    ? path.join(GEN_DIR, 'evolution', 'nodes.json')
    : path.join(DATA_DIR, 'evolution_nodes.json');
  let evolutionGraph = {};
  if (fs.existsSync(evoPath)) {
    const evo = readJSON(evoPath);
    const nodes = evo.nodes || evo.evolutionNodes || [];
    for (const n of nodes) {
      const cid = n.creatureId;
      if (!cid) continue;
      if (!evolutionGraph[cid]) evolutionGraph[cid] = { nodes: [] };
      evolutionGraph[cid].nodes.push(n);
    }
    // stable order by node id
    for (const cid of Object.keys(evolutionGraph)) {
      evolutionGraph[cid].nodes.sort((a,b)=>String(a.id||a.nodeId||'').localeCompare(String(b.id||b.nodeId||'')));
    }
  }

  const launchCreatures = creatures.filter(c => !!c.isLaunch);
  const expCreatures = creatures.filter(c => !c.isLaunch);

  const launchStages = stages.filter(s => !!s.isLaunch);
  const expStages = stages.filter(s => !s.isLaunch);

  const launchWeaponFamilies = weaponFamilies.filter(w => !w.experimental);
  const expWeaponFamilies = weaponFamilies.filter(w => !!w.experimental);

  const launchScope = {
    creatures: launchCreatures.map(c => c.id).sort(),
    stages: launchStages.map(s => s.id).sort(),
    weaponFamilies: launchWeaponFamilies.map(w => w.id).sort()
  };

  const content = {
    schemaVersion: 1,
    creatures,
    mutations,
    stages,
    weaponFamilies,
    slotContracts,
    evolutionGraph,
    launchScope
  };

  const contentLaunch = {
    schemaVersion: 1,
    creatures: launchCreatures,
    stages: launchStages,
    weaponFamilies: launchWeaponFamilies
  };

  const contentExperimental = {
    schemaVersion: 1,
    creatures: expCreatures,
    stages: expStages,
    weaponFamilies: expWeaponFamilies
  };

  assertNoForbiddenId(content, 'content');
  assertNoForbiddenId(contentLaunch, 'content_launch');
  assertNoForbiddenId(contentExperimental, 'content_experimental');

  return { content, contentLaunch, contentExperimental };
}

function buildUIArtifacts() {
  const ui = fs.existsSync(path.join(GEN_DIR, 'ui_style_guide.json'))
    ? readJSON(path.join(GEN_DIR, 'ui_style_guide.json'))
    : null;
  const hud = fs.existsSync(path.join(GEN_DIR, 'hud_layout.json'))
    ? readJSON(path.join(GEN_DIR, 'hud_layout.json'))
    : null;
  return { ui, hud };
}

function validate({ registry, content }) {
  const errors = [];
  const warnings = [];

  // Basic content checks
  const creatureIds = new Set(content.creatures.map(c => c.id));

  // Each creature must have sheet + icon
  const assetIds = new Set(registry.assets.map(a => a.id));
  for (const c of content.creatures) {
    const sheetId = `player.${c.id}.sheet`;
    const iconId = `player.${c.id}.icon`;
    // Non-destructive: missing art must never crash the app. Treat as warnings.
    if (!assetIds.has(sheetId)) warnings.push({ type: 'asset.missingCreatureSheet', creatureId: c.id, assetId: sheetId, isLaunch: !!c.isLaunch });
    if (!assetIds.has(iconId)) warnings.push({ type: 'asset.missingCreatureIcon', creatureId: c.id, assetId: iconId, isLaunch: !!c.isLaunch });
  }

  // Registry paths must exist
  for (const a of registry.assets) {
    const p = path.join(ROOT, a.path);
    if (!fs.existsSync(p)) warnings.push({ type: 'asset.missingOnDisk', assetId: a.id, path: a.path });
  }

  // Parity sanity: if parity directories exist, ensure their files are registered.
  // This prevents "loose assets" being present but unreachable at runtime.
  const scannedDirs = ['bosses', 'tiles', 'items', 'pickup', 'orbital', 'projectiles', 'ui', 'audio'];
  const idPrefixes = {
    bosses: 'boss.',
    tiles: 'tile.',
    items: 'item.',
    pickup: 'pickup.',
    orbital: 'orbital.',
    projectiles: 'projectile.',
    ui: 'ui.',
    audio: 'sfx.'
  };
  const ids = new Set(registry.assets.map(a => a.id));
  for (const d of scannedDirs) {
    const dir = path.join(ASSETS_DIR, d);
    if (!fs.existsSync(dir)) continue;
    const files = listFilesRecursive(dir).filter(p => {
      const ext = path.extname(p).toLowerCase();
      return d === 'audio' ? ['.wav', '.ogg', '.mp3'].includes(ext) : ext === '.png';
    });
    for (const p of files) {
      const base = path.basename(p, path.extname(p));
      const prefix = idPrefixes[d];
      const expected = (d === 'bosses') ? `${prefix}${base}.sheet` : (d === 'audio') ? `${prefix}${base}` : `${prefix}${base}.image`;
      if (!ids.has(expected)) warnings.push({ type: 'asset.unregistered', dir: d, file: relPosix(p), expectedAssetId: expected });
    }
  }

  // Forbidden substring (global)
  assertNoForbiddenId({ registry, content }, 'combined');

  return { criticalErrors: errors, warnings };
}

function main() {
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  const { content, contentLaunch, contentExperimental } = buildContent();
  const { ui, hud } = buildUIArtifacts();
  const registry = buildRegistry({ creatures: content.creatures });
  const manifest = buildManifest({ registry, launchCreatureIds: contentLaunch.creatures.map(c => c.id) });

  const report = validate({ registry, content });

  // Bible importer validation (if present) is included as warnings.
  const bibleReportPath = path.join(GEN_DIR, 'validation_report.json');
  const bibleReport = fs.existsSync(bibleReportPath) ? readJSON(bibleReportPath) : null;
  const bibleWarnings = [];
  if (bibleReport) {
    if (bibleReport.duplicateIds?.length) bibleWarnings.push({ type: 'bible.duplicateIds', items: bibleReport.duplicateIds });
    if (bibleReport.missingReferences?.length) bibleWarnings.push({ type: 'bible.missingReferences', items: bibleReport.missingReferences });
    if (bibleReport.evolutionErrors?.length) bibleWarnings.push({ type: 'bible.evolutionErrors', items: bibleReport.evolutionErrors });
    if (bibleReport.missingAssetsOnDisk?.length) bibleWarnings.push({ type: 'bible.missingAssetsOnDisk', items: bibleReport.missingAssetsOnDisk });
  }

  // Write outputs
  writeJSON(path.join(RUNTIME_DIR, 'content.json'), content);
  writeJSON(path.join(RUNTIME_DIR, 'content_launch.json'), contentLaunch);
  writeJSON(path.join(RUNTIME_DIR, 'content_experimental.json'), contentExperimental);
  writeJSON(path.join(RUNTIME_DIR, 'registry.json'), registry);
  writeJSON(path.join(RUNTIME_DIR, 'manifest.json'), manifest);
  if (ui) writeJSON(path.join(RUNTIME_DIR, 'ui_style_guide.json'), ui);
  if (hud) writeJSON(path.join(RUNTIME_DIR, 'hud_layout.json'), hud);
  writeJSON(path.join(RUNTIME_DIR, 'validation_report.json'), {
    schemaVersion: 1,
    criticalErrors: report.criticalErrors,
    warnings: report.warnings.concat(bibleWarnings)
  });

  if (report.criticalErrors.length) {
    console.error(`Runtime build FAILED with ${report.criticalErrors.length} critical errors.`);
    process.exit(1);
  }
  console.log('Runtime build OK.');
}

main();
