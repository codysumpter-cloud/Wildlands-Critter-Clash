// game_bundle.js - non-module bundle for file:// compatibility
(async function(){
'use strict';


// --- src/diagnostics.js ---

// diagnostics.js - overlay + structured warnings
class Diagnostics {
  constructor() {
    this.enabled = false;
    this.state = {
      fps: 0,
      entities: 0,
      warnings: [],
      activeMutations: [],
      activeSlots: {},
      missingAnchors: [],
      missingAssets: []
    };
    this._fps = { last: performance.now(), frames: 0 };
    this._el = null;
    this._bindKeys();
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.key === '`' || e.key === '~' || e.key === 'F1') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this._ensureEl();
    if (this._el) this._el.style.display = this.enabled ? 'block' : 'none';
  }

  _ensureEl() {
    if (this._el) return;
    const el = document.createElement('div');
    el.id = 'diag';
    el.style.position = 'absolute';
    el.style.left = '8px';
    el.style.top = '8px';
    el.style.padding = '8px 10px';
    el.style.background = 'rgba(10,10,14,0.75)';
    el.style.color = '#e8e3e3';
    el.style.font = '12px/1.25 monospace';
    el.style.whiteSpace = 'pre';
    el.style.zIndex = 9999;
    el.style.border = '1px solid rgba(255,255,255,0.18)';
    el.style.borderRadius = '6px';
    document.body.appendChild(el);
    this._el = el;
    this._el.style.display = 'none';
  }

  tickFPS() {
    const t = performance.now();
    this._fps.frames++;
    const dt = t - this._fps.last;
    if (dt >= 400) {
      this.state.fps = Math.round((this._fps.frames * 1000) / dt);
      this._fps.frames = 0;
      this._fps.last = t;
    }
  }

  clearFrame() {
    this.state.warnings.length = 0;
    this.state.missingAnchors.length = 0;
    this.state.missingAssets.length = 0;
  }

  warn(code, details) {
    this.state.warnings.push({ code, details });
  }

  render() {
    if (!this.enabled || !this._el) return;
    const s = this.state;
    const lines = [];
    lines.push(`WILDLANDS DIAGNOSTICS  (toggle: ~ / F1)`);
    lines.push(`FPS: ${s.fps}   Entities: ${s.entities}`);
    lines.push('');
    lines.push(`Active mutations (${s.activeMutations.length}):`);
    for (const m of s.activeMutations.slice(0, 12)) lines.push(` - ${m}`);
    if (s.activeMutations.length > 12) lines.push(` ... +${s.activeMutations.length - 12} more`);
    lines.push('');
    lines.push('Attachment slots:');
    for (const [k,v] of Object.entries(s.activeSlots)) lines.push(` - ${k}: ${v}`);
    if (!Object.keys(s.activeSlots).length) lines.push(' - (none)');
    lines.push('');
    if (s.missingAnchors.length) {
      lines.push('Missing anchors:');
      for (const a of s.missingAnchors.slice(0, 10)) lines.push(` - ${a}`);
      if (s.missingAnchors.length > 10) lines.push(` ... +${s.missingAnchors.length - 10} more`);
      lines.push('');
    }
    if (s.missingAssets.length) {
      lines.push('Missing assets:');
      for (const a of s.missingAssets.slice(0, 10)) lines.push(` - ${a}`);
      if (s.missingAssets.length > 10) lines.push(` ... +${s.missingAssets.length - 10} more`);
      lines.push('');
    }
    if (s.warnings.length) {
      lines.push('Warnings:');
      for (const w of s.warnings.slice(0, 10)) lines.push(` - ${w.code}: ${JSON.stringify(w.details)}`);
      if (s.warnings.length > 10) lines.push(` ... +${s.warnings.length - 10} more`);
    } else {
      lines.push('Warnings: (none)');
    }
    this._el.textContent = lines.join('\n');
  }
}




// --- src/pixelArtUpgradeEngine.js ---

// pixelArtUpgradeEngine.js
// Runtime, non-destructive pixel upgrade pipeline.
// - Uses ONLY source pixels from the loaded asset image.
// - Produces an upgraded ImageBitmap/Canvas for rendering.
// - Keeps originals intact in memory.
// Notes: This is intentionally conservative to avoid breaking silhouettes/animations.

class PixelArtUpgradeEngine {
  constructor({ diagnostics } = {}) {
    this._diag = diagnostics;
    this._enabled = true;
    // Tunables per tag/category (can be extended via Bible later)
    this._profiles = {
      player: {
        // Global palette discipline (not per-material): conservative
        targetColors: 48,
        // Remove isolated 1px speckles
        despecklePasses: 1,
        // Boundary contrast enhancement
        outlineBoost: true,
        // Slight contrast stretch (safe)
        contrast: 0.06,
      },
      icon: {
        targetColors: 32,
        despecklePasses: 1,
        outlineBoost: true,
        contrast: 0.10,
      },
    };
  }

  setEnabled(v) { this._enabled = !!v; }
  enabled() { return this._enabled; }

  profileForAssetTags(tags = []) {
    // If it's a player icon, treat as icon profile but keep player discipline.
    const isPlayer = tags.includes('player');
    const isIcon = tags.includes('icon');
    if (isPlayer && isIcon) return this._profiles.icon;
    if (isPlayer) return this._profiles.player;
    if (isIcon) return this._profiles.icon;
    return null;
  }

  async upgradeImage(img, { tags = [], meta = {} } = {}) {
    if (!this._enabled) return null;
    const profile = this.profileForAssetTags(tags);
    if (!profile) return null;

    const w = meta?.w || img.naturalWidth || img.width;
    const h = meta?.h || img.naturalHeight || img.height;
    if (!w || !h) return null;

    const canvas = this._makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // 1) Build a sampled palette
    const sampleStride = (w * h > 200_000) ? 2 : 1;
    const samples = this._sampleColors(data, w, h, sampleStride);

    // 2) Quantize to target palette (using k-means on sampled colors)
    const palette = this._kmeansPalette(samples, profile.targetColors);
    this._mapToPalette(data, palette);

    // 3) Despeckle (isolated pixels)
    for (let i = 0; i < profile.despecklePasses; i++) {
      this._despeckle(data, w, h);
    }

    // 4) Conservative contrast stretch (does not add colors; remaps via palette again)
    if (profile.contrast && profile.contrast > 0) {
      this._contrastStretch(data, w, h, profile.contrast);
      this._mapToPalette(data, palette);
    }

    // 5) Outline boost on boundary pixels (map to darkest palette color)
    if (profile.outlineBoost) {
      this._outlineBoost(data, w, h, palette);
    }

    ctx.putImageData(imageData, 0, 0);

    // Prefer ImageBitmap for faster draw
    try {
      if (typeof createImageBitmap === 'function') {
        return await createImageBitmap(canvas);
      }
    } catch (_) {}
    return canvas;
  }

  _makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  _rgbaKey(r, g, b) { return (r << 16) | (g << 8) | b; }

  _sampleColors(data, w, h, stride) {
    const out = [];
    for (let y = 0; y < h; y += stride) {
      const row = y * w * 4;
      for (let x = 0; x < w; x += stride) {
        const i = row + x * 4;
        const a = data[i + 3];
        if (a < 16) continue; // ignore near-transparent
        out.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
    return out;
  }

  _kmeansPalette(samples, k) {
    if (!samples.length) return [[0, 0, 0]];
    // Clamp k
    const K = Math.max(8, Math.min(k, 96, samples.length));
    // Init centroids by picking evenly spaced samples
    const centroids = [];
    const step = Math.max(1, Math.floor(samples.length / K));
    for (let i = 0; i < K; i++) centroids.push(samples[(i * step) % samples.length].slice());

    const iters = 6; // small, deterministic-ish
    const assignments = new Array(samples.length);
    for (let it = 0; it < iters; it++) {
      // Assign
      for (let i = 0; i < samples.length; i++) {
        const [r, g, b] = samples[i];
        let best = 0, bestD = 1e18;
        for (let c = 0; c < centroids.length; c++) {
          const dr = r - centroids[c][0];
          const dg = g - centroids[c][1];
          const db = b - centroids[c][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; best = c; }
        }
        assignments[i] = best;
      }
      // Recompute
      const sums = new Array(centroids.length).fill(0).map(() => [0, 0, 0, 0]);
      for (let i = 0; i < samples.length; i++) {
        const c = assignments[i];
        const s = sums[c];
        s[0] += samples[i][0]; s[1] += samples[i][1]; s[2] += samples[i][2]; s[3] += 1;
      }
      for (let c = 0; c < centroids.length; c++) {
        const n = sums[c][3];
        if (n > 0) {
          centroids[c][0] = (sums[c][0] / n) | 0;
          centroids[c][1] = (sums[c][1] / n) | 0;
          centroids[c][2] = (sums[c][2] / n) | 0;
        }
      }
    }

    // Deduplicate (helps cache + stability)
    const seen = new Set();
    const palette = [];
    for (const c of centroids) {
      const key = this._rgbaKey(c[0], c[1], c[2]);
      if (seen.has(key)) continue;
      seen.add(key);
      palette.push(c);
    }
    return palette.length ? palette : [[0, 0, 0]];
  }

  _mapToPalette(data, palette) {
    const cache = new Map(); // key -> [r,g,b]
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 16) continue;
      const key = this._rgbaKey(data[i], data[i + 1], data[i + 2]);
      const cached = cache.get(key);
      if (cached) {
        data[i] = cached[0]; data[i + 1] = cached[1]; data[i + 2] = cached[2];
        continue;
      }
      let best = palette[0], bestD = 1e18;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      for (let p = 0; p < palette.length; p++) {
        const pr = palette[p][0], pg = palette[p][1], pb = palette[p][2];
        const dr = r - pr, dg = g - pg, db = b - pb;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = palette[p]; }
      }
      cache.set(key, best);
      data[i] = best[0]; data[i + 1] = best[1]; data[i + 2] = best[2];
    }
  }

  _despeckle(data, w, h) {
    const copy = new Uint8ClampedArray(data);
    const idx = (x, y) => (y * w + x) * 4;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = idx(x, y);
        const a = copy[i + 3];
        if (a < 16) continue;

        // Count neighbor colors (excluding transparent)
        const counts = new Map();
        let neigh = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const j = idx(x + ox, y + oy);
            const aj = copy[j + 3];
            if (aj < 16) continue;
            const key = this._rgbaKey(copy[j], copy[j + 1], copy[j + 2]);
            counts.set(key, (counts.get(key) || 0) + 1);
            neigh++;
          }
        }
        if (neigh < 3) continue;

        const selfKey = this._rgbaKey(copy[i], copy[i + 1], copy[i + 2]);
        const selfCount = counts.get(selfKey) || 0;

        // If this pixel is an outlier and a neighbor color dominates, replace it
        if (selfCount <= 1) {
          let bestKey = null, bestCount = 0;
          for (const [k, c] of counts.entries()) {
            if (c > bestCount) { bestCount = c; bestKey = k; }
          }
          if (bestKey !== null && bestCount >= 4) {
            data[i] = (bestKey >> 16) & 255;
            data[i + 1] = (bestKey >> 8) & 255;
            data[i + 2] = bestKey & 255;
          }
        }
      }
    }
  }

  _contrastStretch(data, w, h, amount) {
    // Compute luminance bounds on opaque pixels
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 16) continue;
      const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    if (!(hi > lo + 5)) return;

    const mid = (lo + hi) * 0.5;
    const scale = 1 + amount; // very small
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 16) continue;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        const nv = mid + (v - mid) * scale;
        data[i + c] = Math.max(0, Math.min(255, nv | 0));
      }
    }
  }

  _outlineBoost(data, w, h, palette) {
    // Find darkest palette color by luminance
    let dark = palette[0];
    let darkY = 1e18;
    for (const p of palette) {
      const y = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      if (y < darkY) { darkY = y; dark = p; }
    }
    const idx = (x, y) => (y * w + x) * 4;
    const copy = new Uint8ClampedArray(data);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = idx(x, y);
        const a = copy[i + 3];
        if (a < 16) continue;

        // boundary if any neighbor is transparent
        let boundary = false;
        for (let oy = -1; oy <= 1 && !boundary; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const j = idx(x + ox, y + oy);
            if (copy[j + 3] < 16) { boundary = true; break; }
          }
        }
        if (!boundary) continue;

        // Only darken if pixel is not already dark
        const yv = 0.2126 * copy[i] + 0.7152 * copy[i + 1] + 0.0722 * copy[i + 2];
        if (yv > darkY + 22) {
          data[i] = dark[0]; data[i + 1] = dark[1]; data[i + 2] = dark[2];
        }
      }
    }
  }
}


// --- src/assetStore.js ---

// assetStore.js - unified registry lookup + preloading (no hardcoded paths in gameplay)
class AssetStore {
  constructor({ loadJSON, diagnostics }) {
    this._loadJSON = loadJSON;
    this._diag = diagnostics;
    this._registry = null;
    this._assetsById = new Map();
    this._aliases = {};
    this._images = new Map(); // assetId -> HTMLImageElement (original)
    this._upgraded = new Map(); // assetId -> ImageBitmap/Canvas (upgraded)
    this._upgradeEngine = new PixelArtUpgradeEngine({ diagnostics });
    this._upgradeEnabled = true;
    this._missingOnce = new Set(); // log-once missing ids
  }

  setUpgradeEnabled(enabled) {
    this._upgradeEnabled = !!enabled;
    this._upgradeEngine?.setEnabled(this._upgradeEnabled);
  }

  upgradeEnabled() { return !!this._upgradeEnabled; }

  async init() {
    this._registry = await this._loadJSON('runtime/registry.json');
    this._aliases = this._registry.aliases || {};
    for (const a of (this._registry.assets || [])) this._assetsById.set(a.id, a);
    this._manifest = await this._loadJSON('runtime/manifest.json');
    return this;
  }

  canonicalId(id) {
    return this._aliases[id] || id;
  }

  get(id) {
    const cid = this.canonicalId(id);
    let a = this._assetsById.get(cid);

    // Lazy attachment sprites (runtime registry may not list every attachment PNG).
    // Accepts assetIds like: attachment.<path>.sprite -> assets/attachments/<path>.png
    if (!a && cid.startsWith('attachment.') && cid.endsWith('.sprite')) {
      const key = cid.slice('attachment.'.length, cid.length - '.sprite'.length);
      const path = `assets/attachments/${key}.png`;
      a = { id: cid, type: 'image', path, tags: ['attachment','runtime'], meta: { w: 64, h: 64 } };
      this._assetsById.set(cid, a);
    }

    
    // Meta fallbacks for common sprite sheets (prevents invisible entities if registry meta is missing).
    if (a && (!a.meta)) a.meta = {};
    if (a && a.type === 'image' && a.path) {
      const p = String(a.path);
      // Player sheets: 384×320, 6×5 grid, 64×64 cells
      if ((cid.startsWith('player.') && cid.endsWith('.sheet')) || p.includes('/assets/players/') || p.endsWith('_sheet.png') || p.endsWith('_spritesheet.png') || p.endsWith('clackjaw_sheet.png')) {
        a.meta.cellW = a.meta.cellW || 64;
        a.meta.cellH = a.meta.cellH || 64;
        a.meta.cols = a.meta.cols || 6;
        a.meta.rows = a.meta.rows || 5;
      }
      // Enemy sheets: 384×320, 6×5 grid, 64×64 cells
      if (cid.startsWith('enemy.') || p.includes('/assets/enemies/') || p.startsWith('assets/enemies/')) {
        a.meta.cellW = a.meta.cellW || 64;
        a.meta.cellH = a.meta.cellH || 64;
        a.meta.cols = a.meta.cols || 6;
        a.meta.rows = a.meta.rows || 5;
      }
    }

if (!a) {
      if (!this._missingOnce.has(cid)) {
        this._missingOnce.add(cid);
        this._diag?.state?.missingAssets?.push(cid);
        this._diag?.warn('ASSET_MISSING', { id: cid });
      }
      return null;
    }
    return a;
  }

  // Convenience helpers for common lookups
  creatureSheetAssetId(creatureId) { return `player.${this.canonicalId(creatureId)}.sheet`; }
  creatureIconAssetId(creatureId) { return `player.${this.canonicalId(creatureId)}.icon`; }
  enemySheetAssetId(enemySpriteId) { return `enemy.${enemySpriteId}.sheet`; }

  async preloadAssetIds(assetIds) {
    const unique = Array.from(new Set(assetIds));
    // Never hard-fail the entire runtime on a single missing/bad asset.
    // We log and continue so the menu remains usable and the game can still start.
    await Promise.all(unique.map(async (id) => {
      const a = this.get(id);
      if (!a) return;
      if (a.type === 'spritesheet' || a.type === 'image' || a.type === 'icon') {
        try {
          await this._loadImageFor(id, a.path);
        } catch (e) {
          this._diag?.warn('ASSET_LOAD_FAILED', { id, path: a.path, error: String(e) });
        }
      }
    }));
  }

  async preloadLaunch() {
    const ids = (this._manifest?.preload?.launch) || [];
    return this.preloadAssetIds(ids);
  }

  async _loadImageFor(assetId, path) {
    if (this._images.has(assetId)) return this._images.get(assetId);
    const img = new Image();
    const p = new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${path} (${assetId})`));
    });
    img.src = path;
    const loaded = await p;
    this._images.set(assetId, loaded);

    // Optional runtime upgrade (non-destructive). Uses registry tags/meta to choose profile.
    try {
      const a = this.get(assetId);
      if (a && this._upgradeEnabled) {
        const upgraded = await this._upgradeEngine.upgradeImage(loaded, { tags: a.tags || [], meta: a.meta || {} });
        if (upgraded) this._upgraded.set(assetId, upgraded);
      }
    } catch (e) {
      this._diag?.warn('ASSET_UPGRADE_FAIL', { id: assetId, error: String((e && e.message) || e) });
    }

    return loaded;
  }

  image(assetId) {
    const cid = this.canonicalId(assetId);
    const cached = this._images.get(cid) || this._images.get(assetId);
    if (cached && cached.complete && cached.naturalWidth > 0) return cached;

    // Lazy load image assets on demand (especially attachments).
    const a = this.get(cid);
    if (!a) return null;
    if (a.type !== 'image' && a.type !== 'icon' && a.type !== 'spritesheet') return null;

    let img = cached;
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.src = a.path;
      img.onerror = () => {
        if (!this._missingOnce.has(cid)) {
          this._missingOnce.add(cid);
          this._diag?.warn('IMAGE_LOAD_FAILED', { id: cid, path: a.path });
        }
      };
      this._images.set(cid, img);
    }
    if (img.complete && img.naturalWidth > 0) return img;
    return null;
  }
}


// --- src/contentStore.js ---

// contentStore.js - deterministic, precompiled runtime content access
class ContentStore {
  constructor({ loadJSON, diagnostics, assetStore }) {
    this._loadJSON = loadJSON;
    this._diag = diagnostics;
    this._assetStore = assetStore;
    this.content = null;
    this.contentLaunch = null;
    this.contentExperimental = null;
    this._by = { creature: new Map(), stage: new Map(), mutation: new Map(), weaponFamily: new Map(), weapon: new Map(), weaponForCreature: new Map(), evolutionNode: new Map() };
  }

  setUpgradeEnabled(enabled) {
    this._upgradeEnabled = !!enabled;
    this._upgradeEngine?.setEnabled(this._upgradeEnabled);
  }

  upgradeEnabled() { return !!this._upgradeEnabled; }

  async init() {
    this.content = await this._loadJSON('runtime/content.json');
    this.contentLaunch = await this._loadJSON('runtime/content_launch.json');
    this.contentExperimental = await this._loadJSON('runtime/content_experimental.json');

    // --- Runtime corrective split: enforce LaunchScope stage expectations ---
    // If content_launch.json accidentally contains all stages, treat only meadow_market as launch.
    // Everything else becomes experimental so the UI matches the Bible intent.
    try {
      const LAUNCH_STAGE_ID = 'meadow_market';
      if (Array.isArray(this.contentLaunch?.stages) && this.contentLaunch.stages.length > 1) {
        const keep = [];
        const move = [];
        for (const s of this.contentLaunch.stages) {
          if (s && s.id === LAUNCH_STAGE_ID) keep.push({ ...s, isLaunch: true, isExperimental: false, experimental: false });
          else move.push({ ...s, isLaunch: false, isExperimental: true, experimental: true });
        }
        if (keep.length === 1 && move.length) {
          this.contentLaunch.stages = keep;
          this.contentExperimental.stages = Array.isArray(this.contentExperimental?.stages)
            ? this.contentExperimental.stages.concat(move)
            : move;
        }
      }
    } catch (_) {}

    // --- Weapon family presentation: derive readable labels/icons from weapon mutations when possible ---
    // Keeps underlying weaponFamilyId semantics intact; only improves UI fidelity.
    try {
      const byWeaponId = new Map();
      for (const mut of (this.content?.mutations || [])) {
        const wid = mut && mut.weaponId;
        if (!wid) continue;
        // Prefer explicit weapon-type mutations (WEAPON) for naming.
        const isWeapon = (mut.type === 'WEAPON' || mut.kind === 'WEAPON' || (mut.tags||[]).some(t => String(t).toLowerCase() === 'weapon'));
        if (!isWeapon) continue;
        if (!byWeaponId.has(wid)) byWeaponId.set(wid, mut);
      }
      const applyTo = (arr) => {
        for (const wf of (arr || [])) {
          const mut = byWeaponId.get(wf.id);
          if (!mut) continue;
          wf.displayName = mut.name || wf.displayName;
          // Allow UI to prefer this icon if present
          wf._uiIconAttachment = mut.attachmentSpriteId || null;
        }
      };
      applyTo(this.contentLaunch?.weaponFamilies);
      applyTo(this.contentExperimental?.weaponFamilies);
    } catch (_) {}

    for (const c of this.content.creatures) this._by.creature.set(c.id, c);
    for (const s of this.content.stages) this._by.stage.set(s.id, s);
    for (const m of this.content.mutations) this._by.mutation.set(m.id, m);
    for (const w of this.content.weaponFamilies) this._by.weaponFamily.set(w.id, w);
    for (const we of (this.content.weapons || [])) {
      const wid = we.weaponId || we.id;
      if (wid) this._by.weapon.set(wid, we);
      if (we.creatureId) this._by.weaponForCreature.set(we.creatureId, we);
    }

    // Index evolution nodes globally by id for fast lookup (node picks drive visuals).
    try {
      const eg = this.content.evolutionGraph || {};
      for (const g of Object.values(eg)) {
        const nodes = g?.nodes || [];
        for (const n of nodes) {
          if (n && n.id) this._by.evolutionNode.set(n.id, n);
        }
      }
    } catch (_) {}
    return this;
  }

  creature(id) { return this._by.creature.get(id) || null; }
  stage(id) { return this._by.stage.get(id) || null; }
  mutation(id) { return this._by.mutation.get(id) || null; }
  evolutionNode(id) { return this._by.evolutionNode.get(id) || null; }
  weaponFamily(id) { return this._by.weaponFamily.get(id) || null; }
  weapon(id) { return this._by.weapon.get(id) || null; }
  weaponForCreature(creatureId) { return this._by.weaponForCreature.get(creatureId) || null; }

  listCreatures(showExperimental=false) {
    const nameOf = (x) => String((x && (x.displayName ?? x.name ?? x.id)) ?? '');
    const launch = this.contentLaunch.creatures.slice().sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
    if (!showExperimental) return launch;
    const exp = this.contentExperimental.creatures.slice().sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
    return launch.concat(exp);
  }
  listStages(showExperimental=false) {
    const nameOf = (x) => String((x && (x.displayName ?? x.name ?? x.id)) ?? '');
    const launch = this.contentLaunch.stages.slice().sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
    if (!showExperimental) return launch;
    const exp = this.contentExperimental.stages.slice().sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
    return launch.concat(exp);
  }
  listWeaponFamilies(showExperimental=false) {
    const nameOf = (x) => String((x && (x.displayName ?? x.name ?? x.id)) ?? '');
    const launch = this.contentLaunch.weaponFamilies.slice().sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
    if (!showExperimental) return launch;
    const exp = this.contentExperimental.weaponFamilies.slice().sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));
    return launch.concat(exp);
  }

  launchScope() { return this.content.launchScope; }

  slotContract(creatureId) {
    return (this.content.slotContracts && this.content.slotContracts[creatureId]) || null;
  }

  evolutionNodesForCreature(creatureId) {
    const g = this.content.evolutionGraph?.[creatureId];
    return g?.nodes || [];
  }
}


// --- src/visualAssembler.js ---

// visualAssembler.js - deterministic attachment selection + draw (no per-frame compositing)
class VisualAssembler {
  constructor({ assetStore, contentStore, diagnostics, loadJSON }) {
    this._assets = assetStore;
    this._content = contentStore;
    this._diag = diagnostics;
    this._loadJSON = loadJSON;
    this._anchors = null;
    this._anchorCache = new Map(); // creatureId -> dir -> anchorId -> {x,y}
    this._generated = new Map(); // key -> Canvas
    this._attachCache = new Map(); // key -> resolved attachments (perf)
  }

  setUpgradeEnabled(enabled) {
    this._upgradeEnabled = !!enabled;
    this._upgradeEngine?.setEnabled(this._upgradeEnabled);
  }

  upgradeEnabled() { return !!this._upgradeEnabled; }

  async init() {
    this._anchors = await this._loadJSON('runtime/anchors.json');
    return this;
  }

  _getAnchor(creatureId, dir, anchorId) {
    const key = `${creatureId}|${dir}|${anchorId}`;
    if (this._anchorCache.has(key)) return this._anchorCache.get(key);
    const c = this._anchors?.[creatureId];
    const d = c?.[dir];
    const a = d?.[anchorId] || null;
    if (!a) this._diag?.state?.missingAnchors?.push(key);
    this._anchorCache.set(key, a);
    return a;

  }

_hash(str){
  let h = 2166136261>>>0;
  const s = String(str||'');
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619)>>>0;
  }
  return h>>>0;
}

_pickPalette(creatureId){
  // Small set of earthy/punchy palettes; deterministic by creatureId.
  const pals = [
    ['#2a1b16','#7c4a2e','#d8b07a','#f6e8c6'],
    ['#101a2b','#2a5c6b','#7ec6a8','#e6f2d6'],
    ['#1c1b14','#4b5631','#a8c05a','#f2f6c0'],
    ['#27121f','#6a2f3e','#c65f5f','#f0d2b2'],
    ['#111214','#3b3f4a','#9aa0a8','#f2f2f2']
  ];
  const i = this._hash(creatureId) % pals.length;
  return pals[i];
}

_getGeneratedAttachment(creatureId, attachmentId, slot){
  const key = `${creatureId}|${attachmentId}|${slot}`;
  if (this._generated.has(key)) return this._generated.get(key);
  const pal = this._pickPalette(creatureId);
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Always draw a readable silhouette (no pure squares/circles):
  // slot influences the shape language.
  const base = pal[0], mid = pal[1], hi = pal[2], rim = pal[3] || pal[2];

  const px = (x,y,w=1,h=1,color=mid)=>{ ctx.fillStyle=color; ctx.fillRect(x,y,w,h); };

  // clear
  ctx.clearRect(0,0,32,32);

  const s = String(slot||'CHEST').toUpperCase();
  if (s.includes('HEAD')) {
    const aid = String(attachmentId||'').toLowerCase();
    const isSide = s.includes('HEAD_SIDE');
    const isTusk = aid.includes('tusk') || aid.includes('fang') || aid.includes('boar');
    if (isSide && isTusk) {
      // Tusks (Everything-is-Crab vibe): two curved protrusions
      // left tusk
      px(9, 18, 2, 6, mid);
      px(10, 16, 2, 2, mid);
      px(11, 14, 2, 2, hi);
      px(10, 22, 2, 2, base);
      // right tusk
      px(21, 18, 2, 6, mid);
      px(20, 16, 2, 2, mid);
      px(19, 14, 2, 2, hi);
      px(21, 22, 2, 2, base);
      // gum/face plate
      px(12, 19, 8, 4, base);
      px(12, 19, 8, 1, hi);
    } else {
      // Horn / crest
      for (let i=0;i<10;i++){
        px(16-i, 22-i, 2, 1, mid);
        px(15+i, 22-i, 2, 1, mid);
      }
      px(14, 14, 4, 3, base);
      px(14, 14, 4, 1, hi);
      px(12, 18, 8, 3, mid);
      px(12, 21, 8, 2, base);
    }
  } else if (s.includes('BACK')) {
    // Spine plates
    for (let i=0;i<5;i++){
      const x = 8 + i*4;
      px(x, 12+i, 3, 10-i, mid);
      px(x, 12+i, 3, 1, hi);
      px(x, 21, 3, 1, base);
    }
    px(10, 24, 12, 3, base);
  } else if (s.includes('AURA')) {
    // Aura shard ring (not a circle; faceted)
    for (let i=0;i<8;i++){
      const x = 4 + i*3;
      px(x, 6 + (i%2), 2, 2, hi);
      px(x, 23 - (i%2), 2, 2, hi);
    }
    const dots = isBearClaw ? (8 + Math.min(10, Math.floor(power*4))) : (6 + Math.min(6, Math.floor(power*2)));
    for (let i=0;i<dots;i++){
      const y = 9 + i*3;
      px(6 + (i%2), y, 2, 2, hi);
      px(24 - (i%2), y, 2, 2, hi);
    }
    px(12, 12, 8, 8, mid);
    px(13, 13, 6, 6, base);
  } else if (s.includes('HAND') || s.includes('FRONT')) {
    // Claw / gauntlet
    px(10, 12, 12, 10, mid);
    px(11, 13, 10, 8, base);
    px(22, 14, 3, 2, hi);
    px(22, 18, 3, 2, hi);
    px(8, 20, 16, 3, mid);
    // talons
    px(24, 13, 4, 2, rim);
    px(24, 17, 4, 2, rim);
    px(24, 21, 4, 2, rim);
  } else {
    // Chest plating / bark plates
    px(9, 10, 14, 12, mid);
    px(10, 11, 12, 10, base);
    px(11, 12, 10, 2, hi);
    px(11, 16, 10, 1, hi);
    px(9, 22, 14, 3, mid);
    px(10, 23, 12, 2, base);
    // notch edges (avoid rectangular feel)
    px(9, 12, 1, 2, mid);
    px(22, 17, 1, 2, mid);
  }

  // outline (subtle)
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(1,1,30,30);

  this._generated.set(key, c);
  return c;
}

  // Deterministic resolution:
  // - enforce slot caps via SlotContracts
  // - replacesGroup: higher tier replaces lower in group
  // - sort: slot priority -> layerOrder -> attachmentId
  resolveAttachments(creatureId, activeMutations) {
    const cacheKey = `${creatureId}|${Array.isArray(activeMutations)?activeMutations.join(','):""}`;
    const cached = this._attachCache.get(cacheKey);
    if (cached) return cached;

    const sc = this._content.slotContract(creatureId);
    const caps = sc?.slotCaps || {};
    const order = sc?.visualPriorityOrder || ["HEAD_TOP","HEAD_SIDE","CHEST","BACK","AURA","MAIN_HAND","PROJECTILE","ORBIT"];
    const slotPriority = new Map(order.map((s,i)=>[s,i]));

    // Gather attachment candidates
    const cands = [];
    for (const mutId of activeMutations) {
      // Active list may contain either legacy mutationIds OR evolution nodeIds.
      const m = this._content.mutation(mutId);
      const n = m ? null : this._content.evolutionNode?.(mutId);
      if (!m && !n) continue;

      const vbs = m
        ? ((Array.isArray(m.visual_bindings) && m.visual_bindings.length)
            ? m.visual_bindings
            : ((m.attachmentSpriteId || m.slot) ? [{ type: 'attachment', anchor: m.slot, attachmentId: m.attachmentSpriteId, priority: 0 }] : []))
        : ((n && Array.isArray(n.visuals) && n.visuals.length)
            ? n.visuals.map(v => ({ type: 'attachment', anchor: v.slot, attachmentId: v.attachmentSpriteId, layerOrder: v.priority ?? 0 }))
            : (n ? (()=>{
                // Fail-soft: if the Bible node lacks explicit visuals, infer a creature-themed slot part
                // from node id/name keywords (keeps mutations visibly changing the character).
                const nm = String(n.name||n.id||'').toLowerCase();
                let slotGuess = 'CHEST';
                if (nm.includes('tusk') || nm.includes('horn') || nm.includes('antler') || nm.includes('fang')) slotGuess = 'HEAD_SIDE';
                else if (nm.includes('crest') || nm.includes('crown') || nm.includes('head')) slotGuess = 'HEAD_TOP';
                else if (nm.includes('spine') || nm.includes('back') || nm.includes('carapace')) slotGuess = 'BACK';
                else if (nm.includes('aura') || nm.includes('halo') || nm.includes('field')) slotGuess = 'AURA';
                return [{ type: 'attachment', anchor: slotGuess, attachmentId: `auto_${n.id||mutId}_${slotGuess}_${(nm.includes('tusk')?'tusk':'')}`.replace(/\s+/g,'_'), layerOrder: 0 }];
              })()
            : []));
      for (const vb of vbs) {
        if (vb.type !== 'attachment') continue;
        let slot = vb.anchor || vb.slot || m.slot || 'CHEST';
        // Map abstract slots to available anchor ids.
        const S = String(slot||'').toUpperCase();
        if (S === 'AURA') slot = 'AURA_CENTER';
        else if (S === 'ORBIT' || S === 'WAIST' || S === 'HEAD_SIDE' || S === 'PROJECTILE') slot = 'CHEST';
        else slot = S;
        const group = vb.replacesGroup || null;
        const tier = vb.tier ?? 0;
        let attachmentId = vb.attachmentId || vb.spriteKey || m?.attachmentSpriteId || n?.attachmentSpriteId;
        if (!attachmentId) continue;
        if (attachmentId.startsWith('attach/')) attachmentId = attachmentId.slice('attach/'.length);
        if (typeof attachmentId === 'string' && attachmentId.includes('/')) {
          // keep subpaths (e.g., orbital/blood)
        }

        // Resolve to an actual registered asset id. (attachment.* preferred; fall back to vfx.*)
        const candidates = [];
        if (typeof attachmentId === 'string') {
          // Accept already-qualified ids (attachment.*.sprite / vfx.*.sprite)
          if ((attachmentId.startsWith('attachment.') || attachmentId.startsWith('vfx.')) && attachmentId.endsWith('.sprite')) {
            candidates.push(attachmentId);
          }
          // Legacy shorthand keys
          candidates.push(`attachment.${attachmentId}.sprite`);
          if (attachmentId.startsWith('vfx_')) candidates.push(`vfx.${attachmentId.slice(4)}.sprite`);
          candidates.push(`vfx.${attachmentId}.sprite`);
        }
        const assetId = candidates.find(id => this._assets.get(id));
        if (!assetId) {
          // fail-soft: generate a lightweight, palette-locked attachment sprite at runtime.
          this._diag?.warn?.('VISUAL_SPRITE_MISSING', { id: attachmentId, owner: mutId });
          assetId = `__gen__:${attachmentId}`;
        }
        cands.push({
          mutId,
          slot,
          group,
          tier,
          layerOrder: vb.layerOrder ?? 0,
          attachmentId,
          assetId,
          vfxLayer: !!vb.vfxLayer,
          offsetX: vb.offsetX ?? 0,
          offsetY: vb.offsetY ?? 0,
          scale: vb.scale ?? 1.0
        });
      }
    }

    // replacesGroup resolution (take max tier; tie -> lexicographic attachmentId)
    const bestByGroup = new Map();
    for (const c of cands) {
      if (!c.group) continue;
      const prev = bestByGroup.get(c.group);
      if (!prev || c.tier > prev.tier || (c.tier === prev.tier && c.attachmentId < prev.attachmentId)) bestByGroup.set(c.group, c);
    }
    const filtered = cands.filter(c => !c.group || bestByGroup.get(c.group) === c);

    // Slot caps
    const bySlot = new Map();
    for (const c of filtered) {
      const arr = bySlot.get(c.slot) || [];
      arr.push(c);
      bySlot.set(c.slot, arr);
    }
    const final = [];
    for (const [slot, arr] of bySlot.entries()) {
      arr.sort((a,b)=>{
        const pa = slotPriority.get(a.slot) ?? 999;
        const pb = slotPriority.get(b.slot) ?? 999;
        if (pa!==pb) return pa-pb;
        if (a.layerOrder!==b.layerOrder) return a.layerOrder-b.layerOrder;
        return a.attachmentId.localeCompare(b.attachmentId);
      });
      const cap = caps[slot];
      const take = (cap === undefined) ? arr : arr.slice(0, Math.max(0, cap|0));
      final.push(...take);
    }

    // Global deterministic sort for draw order
    final.sort((a,b)=>{
      const pa = slotPriority.get(a.slot) ?? 999;
      const pb = slotPriority.get(b.slot) ?? 999;
      if (pa!==pb) return pa-pb;
      if (a.layerOrder!==b.layerOrder) return a.layerOrder-b.layerOrder;
      return a.attachmentId.localeCompare(b.attachmentId);
    });

    // cache (cap size to avoid unbounded growth)
    this._attachCache.set(cacheKey, final);
    if (this._attachCache.size > 256) {
      const first = this._attachCache.keys().next().value;
      if (first) this._attachCache.delete(first);
    }
    return final;
  }

  drawCreature(ctx, { creatureId, dir, frameCol, frameRow, x, y, scale=1, activeMutations=[] }) {
    const sheetId = this._assets.creatureSheetAssetId(creatureId);
    const sheet = this._assets.image(sheetId);
    const sheetMeta = this._assets.get(sheetId)?.meta;
    if (!sheet || !sheetMeta) return;

    const cellW = sheetMeta.cellW || 96;
    const cellH = sheetMeta.cellH || 96;

    // base
    ctx.drawImage(
      sheet,
      frameCol * cellW, frameRow * cellH, cellW, cellH,
      Math.round(x - (cellW*scale)/2), Math.round(y - (cellH*scale)/2),
      Math.round(cellW*scale), Math.round(cellH*scale)
    );

    const attachments = this.resolveAttachments(creatureId, activeMutations);
    // surface slot usage to diagnostics
    if (this._diag) {
      const slots = {};
      for (const a of attachments) slots[a.slot] = (slots[a.slot]||0)+1;
      this._diag.state.activeSlots = slots;
    }

    for (const a of attachments) {
      let img = null;
      if (typeof a.assetId === 'string' && a.assetId.startsWith('__gen__:')) {
        img = this._getGeneratedAttachment(creatureId, a.attachmentId, a.slot);
      } else {
        img = this._assets.image(a.assetId);
      }
      if (!img) continue;
      const anchor = this._getAnchor(creatureId, dir, a.slot) || this._getAnchor(creatureId, dir, "CHEST") || { x: cellW/2, y: cellH/2 };
      const ax = (x - (cellW*scale)/2) + (anchor.x*scale) + (a.offsetX*scale);
      const ay = (y - (cellH*scale)/2) + (anchor.y*scale) + (a.offsetY*scale);
      const w = 64 * scale * a.scale;
      const h = 64 * scale * a.scale;
      ctx.drawImage(img, Math.round(ax - w/2), Math.round(ay - h/2), Math.round(w), Math.round(h));
    }
  }
}


// --- src/mutationSystem.js ---

// mutationSystem.js - deterministic mutation selection + application
class MutationSystem {
  constructor({ contentStore, diagnostics }) {
    this._content = contentStore;
    this._diag = diagnostics;
    // Active picks may contain either legacy mutationIds or evolution nodeIds.
    this.active = []; // deterministic order
    this._seed = 1337;
    // Short history of recently OFFERED nodeIds to avoid immediate repeats.
    this._offerHistory = [];
    this._offerHistoryMax = 6;
  }

  reset(seed=1337) {
    this.active.length = 0;
    this._seed = seed|0;
    this._offerHistory.length = 0;
  }

  // deterministic RNG (LCG)
  _rand() {
    this._seed = (1664525 * this._seed + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  add(id) {
    if (!id) return false;
    if (this.active.includes(id)) return false;
    this.active.push(id);
    this.active.sort(); // deterministic stable ordering for replay safety
    return true;
  }

  _rarityWeight(r) {
    const weights = { common: 1.0, uncommon: 0.65, rare: 0.35, epic: 0.18, legendary: 0.08 };
    return weights[r] || 0.4;
  }

  // Bible-true Directed Evolution drafting (creature-scoped), with fail-soft fallback to legacy mutations.
  draftChoices(count=3, { creatureId=null } = {}) {
    const gNodes = creatureId ? (this._content.evolutionNodesForCreature?.(creatureId) || []) : [];
    if (gNodes && gNodes.length) {
      const activeSet = new Set(this.active);

      // Determine locked exclusive groups by already-taken nodes.
      const lockedGroups = new Set();
      for (const id of activeSet) {
        const n = this._content.evolutionNode?.(id);
        if (n?.exclusiveGroup) lockedGroups.add(n.exclusiveGroup);
      }

      const prereqOk = (n) => {
        const prs = Array.isArray(n.prereqs) ? n.prereqs : [];
        for (const p of prs) {
          if (!activeSet.has(p)) return false;
        }
        return true;
      };

      let avail = gNodes.filter(n => n && n.id && !activeSet.has(n.id) && prereqOk(n) && !(n.exclusiveGroup && lockedGroups.has(n.exclusiveGroup)));
      // Avoid immediately repeating recently offered nodes unless no alternatives.
      const notRecent = avail.filter(n => !this._offerHistory.includes(n.id));
      if (notRecent.length) avail = notRecent;

      const picked = [];
      for (let i=0;i<count && avail.length;i++) {
        const total = avail.reduce((s,n)=>s+this._rarityWeight(n.rarity),0);
        let r = this._rand() * total;
        let idx = 0;
        for (; idx<avail.length; idx++) {
          r -= this._rarityWeight(avail[idx].rarity);
          if (r <= 0) break;
        }
        const n = avail.splice(Math.min(idx, avail.length-1),1)[0];
        picked.push(n.id);
      }

      // Track offer history
      for (const id of picked) {
        this._offerHistory.push(id);
        if (this._offerHistory.length > this._offerHistoryMax) this._offerHistory.shift();
      }
      return picked;
    }

    // Legacy global pool fallback (kept for safety / older content).
    const pool = this._content.content.mutations || [];
    const avail = pool.filter(m => m && m.id && !this.active.includes(m.id));
    const picked = [];
    for (let i=0;i<count && avail.length;i++) {
      const total = avail.reduce((s,m)=>s+this._rarityWeight(m.rarity),0);
      let r = this._rand() * total;
      let idx = 0;
      for (; idx<avail.length; idx++) {
        r -= this._rarityWeight(avail[idx].rarity);
        if (r <= 0) break;
      }
      const m = avail.splice(Math.min(idx, avail.length-1),1)[0];
      picked.push(m.id);
    }
    return picked;
  }
}


// --- src/spawnDirector.js ---


// spawnDirector.js - launch scope enforcement + enemy sprite selection via registry
class SpawnDirector {
  constructor({ contentStore, assetStore, diagnostics }) {
    this._content = contentStore;
    this._assets = assetStore;
    this._diag = diagnostics;
    this._enemyIds = null;
  }

  initEnemyCatalog() {
    // derive enemy sprite ids from registry (no hardcoded arrays)
    const reg = this._assets._registry;
    const ids = [];
    for (const a of (reg?.assets || [])) {
      if ((a.tags || []).includes('enemy') && a.type === 'spritesheet') {
        // enemy.<id>.sheet
        const m = /^enemy\.(.+)\.sheet$/.exec(a.id);
        if (m) ids.push(m[1]);
      }
    }
    ids.sort();
    this._enemyIds = ids;
    return ids;
  }

  enforceLaunchScope({ creatureId, stageId, weaponFamilyId, showExperimental=false }) {
    const scope = this._content.launchScope();
    const inScope = (arr, id) => arr.includes(id);

    if (!showExperimental) {
      if (!inScope(scope.creatures, creatureId)) creatureId = scope.creatures[0] || creatureId;
      if (!inScope(scope.stages, stageId)) stageId = scope.stages[0] || stageId;
      if (!inScope(scope.weaponFamilies, weaponFamilyId)) weaponFamilyId = scope.weaponFamilies[0] || weaponFamilyId;
    }
    return { creatureId, stageId, weaponFamilyId };
  }

  pickEnemySpriteId() {
    if (!this._enemyIds) this.initEnemyCatalog();
    if (!this._enemyIds.length) return null;
    // deterministic-ish: use time bucket but stable per second
    const i = (Math.floor(performance.now()/1000) % this._enemyIds.length);
    return this._enemyIds[i];
  }
}


// --- game.js ---

// game.js (module) - deterministic, data-driven mutation arena prototype (refactored)






(async () => {
  'use strict';

  // Legacy sprite-atlas offsets.
  // Some refactored codepaths still reference bare `ox`/`oy` when computing source rects.
  // Provide safe defaults to prevent ReferenceError crashes.
  let ox = 0;
  let oy = 0;

  // --- DOM ---
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');


// HUD offscreen (pixel-locked 640×360 base) composited into main canvas.
const hudCanvas = document.createElement('canvas');
hudCanvas.width = 640;
hudCanvas.height = 360;
const hudCtx = hudCanvas.getContext('2d');
if (hudCtx) hudCtx.imageSmoothingEnabled = false;

function hudScaleFor(viewW, viewH) {
  const raw = Math.min(viewW / 640, viewH / 360);
  const i = Math.max(0, Math.floor(raw));
  if (raw >= i + 0.98) return i + 1;
  if (raw >= i + 0.50) return Math.max(0.5, i + 0.5);
  return Math.max(0.5, i || 0.5);
}

function getHudRects(viewW, viewH) {
  const scale = hudScaleFor(viewW, viewH);
  // Anchor HUD to the viewport instead of centering it. This keeps HUD positions
  // stable across all CSS/canvas scaling modes (itch embeds, fullscreen, etc.).
  const ox = 0;
  const oy = 0;
  const S = (x,y,w,h)=>({ x: ox + x*scale, y: oy + y*scale, w: w*scale, h: h*scale, ox, oy, scale });
  return {
    BASE_RES: { w: 640, h: 360 },
    scale, ox, oy,
    hp: S(16,16,180,20),
    timer: S((640-120)/2,16,120,20),
    abilities: [S(16,290,48,48), S(16+48+12,290,48,48), S(16+(48+12)*2,290,48,48), S(16+(48+12)*3,290,48,48)],
    // Evolution upgrades panel (4 slots, icon-only)
    evoSlots: [
      S(640-16-(36*4 + 6*3), 292, 36, 36),
      S(640-16-(36*3 + 6*2), 292, 36, 36),
      S(640-16-(36*2 + 6*1), 292, 36, 36),
      S(640-16-(36*1 + 6*0), 292, 36, 36)
    ],
    xp: S(80,332,480,12),
    boss: S(40,40,560,24),
    minimap: S(640-16-64,360-16-64,64,64)
  };
}

function formatTime(sec){
  sec = Math.max(0, sec|0);
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function drawHudBase(state) {
  if (!hudCtx) return;
  hudCtx.setTransform(1,0,0,1,0,0);
  hudCtx.clearRect(0,0,640,360);
  hudCtx.imageSmoothingEnabled = false;

  const panelFill = 'rgba(0,0,0,0.55)';
  const panelStroke = 'rgba(255,214,138,0.38)';
  const text = '#f2eeee';
  const textDim = 'rgba(242,238,238,0.82)';
  const hpGreen = 'rgba(120,240,120,0.85)';
  const xpBlue = 'rgba(120,190,255,0.85)';

  const R = { hp:{x:16,y:16,w:180,h:20}, timer:{x:(640-120)/2,y:16,w:120,h:20},
    abilities:[{x:16,y:290,w:48,h:48},{x:76,y:290,w:48,h:48},{x:136,y:290,w:48,h:48},{x:196,y:290,w:48,h:48}],
    evo:[{x:640-16-(36*4 + 6*3),y:292,w:36,h:36},{x:640-16-(36*3 + 6*2),y:292,w:36,h:36},{x:640-16-(36*2 + 6*1),y:292,w:36,h:36},{x:640-16-(36*1 + 6*0),y:292,w:36,h:36}],
    xp:{x:80,y:332,w:480,h:12}, boss:{x:40,y:40,w:560,h:24} };

  const p = state.player || { hp:0, maxHp:1, abilities:[] };
  const hp = Math.max(0, p.hp|0);
  const mhp = Math.max(1, p.maxHp|0);
  const hpPct = Math.max(0, Math.min(1, hp / mhp));

  // HP panel
  hudCtx.fillStyle = panelFill;
  hudCtx.fillRect(R.hp.x-2, R.hp.y-2, R.hp.w+4, R.hp.h+14);
  hudCtx.strokeStyle = panelStroke;
  hudCtx.strokeRect(R.hp.x-2, R.hp.y-2, R.hp.w+4, R.hp.h+14);

  hudCtx.fillStyle = text;
  hudCtx.font = '10px monospace';
  hudCtx.fillText(`HP ${hp}/${mhp}`, R.hp.x, R.hp.y+8);

  hudCtx.fillStyle = 'rgba(255,255,255,0.12)';
  hudCtx.fillRect(R.hp.x, R.hp.y+12, R.hp.w, 6);
  hudCtx.fillStyle = hpGreen;
  hudCtx.fillRect(R.hp.x, R.hp.y+12, Math.round(R.hp.w*hpPct), 6);

  // Timer / Boss bar
  const bossActive = !!state.bossActive;
  const tRect = bossActive ? R.boss : R.timer;
  hudCtx.fillStyle = panelFill;
  hudCtx.fillRect(tRect.x-2, tRect.y-2, tRect.w+4, tRect.h+4);
  hudCtx.strokeStyle = panelStroke;
  hudCtx.strokeRect(tRect.x-2, tRect.y-2, tRect.w+4, tRect.h+4);

  const rem = Math.max(0, (BOSS_COUNTDOWN_SEC||900) - (state.runTimeSec||0));
  const timeStr = bossActive ? 'BOSS' : `BOSS IN ${formatTime(rem)}`;
  const tx = tRect.x + Math.round(tRect.w/2) - Math.round(hudCtx.measureText(timeStr).width/2);
  hudCtx.fillStyle = text;
  hudCtx.fillText(timeStr, tx, tRect.y + 12);

  if (bossActive && state.boss){
    const b = state.boss;
    const pct = Math.max(0, Math.min(1, b.hp / (b.maxHp||b.hp||1)));
    hudCtx.fillStyle = 'rgba(255,255,255,0.12)';
    hudCtx.fillRect(tRect.x, tRect.y+14, tRect.w, 6);
    hudCtx.fillStyle = 'rgba(255,120,120,0.9)';
    hudCtx.fillRect(tRect.x, tRect.y+14, Math.round(tRect.w*pct), 6);
  }

  // Abilities HUD (left side) — only render when the player actually has ability slots.
  // This prevents a permanent "extra panel" from appearing in builds where abilities
  // are not wired yet, while keeping support for future ability icons.
  const abilList = Array.isArray(p.abilities) ? p.abilities : [];
  const showAbilities = abilList.length > 0;
  if (showAbilities) {
    const slots = Math.min(4, Math.max(1, abilList.length));
    for (let i=0;i<slots;i++){
      const a = R.abilities[i];
      hudCtx.fillStyle = panelFill;
      hudCtx.fillRect(a.x, a.y, a.w, a.h);
      hudCtx.strokeStyle = panelStroke;
      hudCtx.strokeRect(a.x, a.y, a.w, a.h);
    }
  }

  // Evolution upgrades panel (4 slots, icon-only)
  // Each slot is linked deterministically to one chosen mutation/evolution.
  try {
    const muts = Array.isArray(state.activeMutations) ? state.activeMutations : [];
    if (muts.length) {
      for (let i=0;i<4;i++){
      const s = R.evo[i];
      hudCtx.fillStyle = panelFill;
      hudCtx.fillRect(s.x, s.y, s.w, s.h);
      hudCtx.strokeStyle = panelStroke;
      hudCtx.strokeRect(s.x, s.y, s.w, s.h);

      const mid = muts[i];
      if (!mid) continue;
      const m = (typeof content !== 'undefined' && content && content.mutation) ? content.mutation(mid) : null;
      const spriteKey = m && (m.attachmentSpriteId || (m.visual_bindings && m.visual_bindings[0] && m.visual_bindings[0].spriteKey));
      const name = spriteKey ? String(spriteKey).split('/').pop() : null;
      const aid = name ? `attachment.${name}.sprite` : null;
      const img = (aid && typeof assets !== 'undefined' && assets && assets.image) ? assets.image(aid) : null;
      if (!img) continue;
      const pad = 4;
      hudCtx.drawImage(img, s.x+pad, s.y+pad, s.w-pad*2, s.h-pad*2);
      }
    }
  } catch(_){ }

  // XP bar
  hudCtx.fillStyle = panelFill;
  hudCtx.fillRect(R.xp.x-2, R.xp.y-2, R.xp.w+4, R.xp.h+4);
  hudCtx.strokeStyle = panelStroke;
  hudCtx.strokeRect(R.xp.x-2, R.xp.y-2, R.xp.w+4, R.xp.h+4);

  const xpPct = Math.max(0, Math.min(1, (state.xpToNext ? (state.xp/state.xpToNext) : 0)));
  hudCtx.fillStyle = 'rgba(255,255,255,0.12)';
  hudCtx.fillRect(R.xp.x, R.xp.y, R.xp.w, R.xp.h);
  hudCtx.fillStyle = xpBlue;
  hudCtx.fillRect(R.xp.x, R.xp.y, Math.round(R.xp.w*xpPct), R.xp.h);

  hudCtx.fillStyle = textDim;
  hudCtx.fillText(`LV ${state.level||0}`, R.xp.x, R.xp.y-4);

  // Touch joystick visualization (UI-only; does not affect game logic).
  // Drawn on HUD layer to avoid interfering with world rendering.
  try {
    if (typeof touchCtl !== 'undefined' && touchCtl && touchCtl.moveId !== null && uiScreen === 'ingame') {
      const x0 = Math.round(touchCtl.moveStartN.x * 640);
      const y0 = Math.round(touchCtl.moveStartN.y * 360);
      const x1 = Math.round(touchCtl.moveNowN.x * 640);
      const y1 = Math.round(touchCtl.moveNowN.y * 360);
      const dx = x1 - x0;
      const dy = y1 - y0;
      const max = 42;
      const len = Math.hypot(dx, dy) || 1;
      const s = Math.min(1, max / len);
      const kx = Math.round(x0 + dx * s);
      const ky = Math.round(y0 + dy * s);

      hudCtx.save();
      hudCtx.globalAlpha = 0.9;
      hudCtx.lineWidth = 2;
      hudCtx.strokeStyle = 'rgba(255,214,138,0.55)';
      hudCtx.fillStyle = 'rgba(0,0,0,0.35)';
      hudCtx.beginPath(); hudCtx.arc(x0, y0, max, 0, Math.PI*2); hudCtx.fill(); hudCtx.stroke();
      hudCtx.beginPath(); hudCtx.arc(kx, ky, 14, 0, Math.PI*2); hudCtx.fill(); hudCtx.stroke();
      hudCtx.restore();
	    }
  } catch(_){ }
}

  if (!ctx) {
    alert('Canvas 2D context could not be created. Try opening via the included local server script.');
    // Keep going so the menu still renders for debugging.
  } else {
    ctx.imageSmoothingEnabled = false;
  }

  const elOverlay = document.getElementById('overlay');
  const elChoices = document.getElementById('choices');
  const elOverlayTitle = document.getElementById('overlayTitle');
  const elOverlaySub = document.getElementById('overlaySub');

  // --- Pause / Game Over overlay (in-run) ---

let gamePaused = false;
let gameOver = false;

const elPauseOverlay = document.createElement('div');
elPauseOverlay.id = 'pauseOverlay';
elPauseOverlay.className = 'hidden';
elPauseOverlay.innerHTML = `
  <div class="panel">
    <div class="panelTitle" id="pauseTitle">Paused</div>
    <div class="panelSub" id="pauseSub">Press Esc to resume.</div>
    <div class="pauseButtons">
      <button id="btnResume" class="btnPrimary">Resume</button>
      <button id="btnRestart" class="btnPrimary">Restart Run</button>
      <button id="btnChangeLoadout" class="btnPrimary">Change Character</button>
      <button id="btnReturnMenu" class="btnPrimary">Return to Menu</button>
    </div>
    <div class="panelHint" id="pauseHint">Tip: You can always press R to restart.</div>
  </div>
`;
const wrap = document.getElementById('wrap') || document.body;
wrap.appendChild(elPauseOverlay);

const elPauseTitle = document.getElementById('pauseTitle');
const elPauseSub = document.getElementById('pauseSub');
const elBtnResume = document.getElementById('btnResume');
const elBtnRestartRun = document.getElementById('btnRestart');
const elBtnChangeLoadout = document.getElementById('btnChangeLoadout');
const elBtnReturnMenu = document.getElementById('btnReturnMenu');

// Always-available touch-safe pause button (top-right).
const elHudPauseBtn = document.getElementById('hudPauseBtn');
if (elHudPauseBtn) {
  elHudPauseBtn.addEventListener('click', () => {
    if (!running) return;
    showPause();
  });
}

function setPaused(v){
  gamePaused = !!v;
  if (elPauseOverlay) {
    elPauseOverlay.classList.toggle('hidden', !gamePaused);
    if (!gamePaused) elPauseOverlay.classList.remove('gameover');
  }
  if (gamePaused) {
    if (elOverlay && !elOverlay.classList.contains('hidden')) {
      elOverlay.classList.add('hidden');
    }
  }
}

function showGameOver(){
  gameOver = true;
  if (elPauseOverlay) {
    elPauseOverlay.classList.add('gameover');
  }
  setPaused(true);
  if (elPauseTitle) elPauseTitle.textContent = 'You Died';
  if (elPauseSub) elPauseSub.textContent = 'Your run ended. Restart or return to menu.';
  if (elBtnResume) elBtnResume.disabled = true;

  // Profile: finalize run stats
  try {
    profEnsure(player?.creatureId);
    if (_profCreature) {
      _profCreature.deaths = (_profCreature.deaths|0) + 1;
      _profCreature.longestSurvivalSec = Math.max(_profCreature.longestSurvivalSec||0, runTimeSec||0);
      profMark();
      profFlush();
    }
  } catch (_) {}
}

function showPause(){
  gameOver = false;
  if (elPauseOverlay) {
    elPauseOverlay.classList.remove('gameover');
  }
  if (elPauseTitle) elPauseTitle.textContent = 'Paused';
  if (elPauseSub) elPauseSub.textContent = 'Press Esc to resume.';
  if (elBtnResume) elBtnResume.disabled = false;
  setPaused(true);
}

function hidePause(){
  setPaused(false);
}

function stopRunToScreen(target){
  running = false;
  pausedForChoice = false;
  gameOver = false;
  gamePaused = false;
  if (elPauseOverlay) elPauseOverlay.classList.add('hidden');
  if (elOverlay) elOverlay.classList.add('hidden');
  try { boss = null; } catch(_){}
  try { enemies = []; projectiles = []; } catch(_){}
  try { player2 = null; } catch(_){}
  showScreen(target);
  if (target === 'main') {
    syncShowcase();
  }
  if (target === 'play') {
    refreshMenu();
    syncShowcase();
  }
}

if (elBtnResume) elBtnResume.addEventListener('click', () => hidePause());
if (elBtnRestartRun) elBtnRestartRun.addEventListener('click', () => { hidePause(); restartRun(); });
if (elBtnChangeLoadout) elBtnChangeLoadout.addEventListener('click', () => stopRunToScreen('play'));
if (elBtnReturnMenu) elBtnReturnMenu.addEventListener('click', () => stopRunToScreen('main'));


  // --- Main menu / screens ---
  const elMainMenu = document.getElementById('mainMenu');
  const elMMButtons = document.getElementById('mmButtons');
  const elMMShowcaseName = document.getElementById('mmShowcaseName');
  const elMMFooterRight = document.getElementById('mmFooterRight');
  const elBtnFullscreen = document.getElementById('btnFullscreen');
  const elToast = document.getElementById('toast');
	  const elFooter = document.getElementById('footer');

  // --- itch.io embed detection ---
  // Detect itch embed reliably: iframe OR ?itch=1
  const urlParams = new URLSearchParams(location.search);
  const isIFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();
  const isItchEmbed = isIFrame || urlParams.get('itch') === '1';
  if (isItchEmbed) document.body.classList.add('itchEmbed');
  const elLogoImg = document.getElementById('mmLogoImg');
  const elLogoText = document.getElementById('mmLogoText');

  const elMastery = document.getElementById('mastery');
  const elMasteryCreatureList = document.getElementById('masteryCreatureList');
  const elFavState = document.getElementById('favState');
  const elBtnSetFavorite = document.getElementById('btnSetFavorite');
  const elBtnClearFavorite = document.getElementById('btnClearFavorite');
  const elBtnBackFromMastery = document.getElementById('btnBackFromMastery');
  const elMasteryIcon = document.getElementById('masteryIcon');
  const elMasteryName = document.getElementById('masteryName');
  const elMasteryRole = document.getElementById('masteryRole');
  const elMasteryWeapon = document.getElementById('masteryWeapon');
  const elMasteryStats = document.getElementById('masteryStats');
  const elMasteryEvolution = document.getElementById('masteryEvolution');

  const elSettings = document.getElementById('settings');
  const elToggleMute = document.getElementById('toggleMute');
  const elToggleReducedMotion = document.getElementById('toggleReducedMotion');
  const elToggleMinimalChrome = document.getElementById('toggleMinimalChrome');
  const elToggleLowVfx = document.getElementById('toggleLowVfx');
  const elToggleScreenshake = document.getElementById('toggleScreenshake');
  const elToggleReducedFlashes = document.getElementById('toggleReducedFlashes');
  const elToggleAllowFit = document.getElementById('toggleAllowFit');
  const elBtnBackFromSettings = document.getElementById('btnBackFromSettings');
  const elBazaar = document.getElementById('bazaar');
  const elBazaarAttachmentList = document.getElementById('bazaarAttachmentList');
  const elBtnBackFromBazaar = document.getElementById('btnBackFromBazaar');
  const elBazaarHint = document.getElementById('bazaarHint');


  const elStart = document.getElementById('start');
  const elCreatureList = document.getElementById('creatureList');
  const elStageList = document.getElementById('stageList');
  const elWeaponList = document.getElementById('weaponList');
  const elToggleExp = document.getElementById('toggleExperimental');
  const elTogglePixel = document.getElementById('togglePixelUpgrade');
  const elBtnStart = document.getElementById('btnStartRun');

  const diag = new Diagnostics();

  function toast(msg, ms=2200){
    if (!elToast) return;
    elToast.textContent = String(msg||'');
    elToast.classList.remove('hidden');
    clearTimeout(elToast._t);
    elToast._t = setTimeout(()=>{ try{ elToast.classList.add('hidden'); }catch{} }, ms);

function escapeHtml(s){
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}

  }

  // --- Bundled JSON loader (file:// safe) ---
  function loadJSON(path) {
    if (window.WILDLANDS_DATA && window.WILDLANDS_DATA[path]) {
      return (typeof structuredClone === 'function')
        ? structuredClone(window.WILDLANDS_DATA[path])
        : JSON.parse(JSON.stringify(window.WILDLANDS_DATA[path]));
    }
    return fetch(path, { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
      return r.json();
    });
  }

  // --- Validation gate ---
  const report = await loadJSON('runtime/validation_report.json');
  if (report.criticalErrors && report.criticalErrors.length) {
    // Fail hard (non-negotiable)
    const msg = [
      'BUILD FAILED: critical validation errors',
      '',
      ...report.criticalErrors.slice(0, 40).map(e => JSON.stringify(e)),
      report.criticalErrors.length > 40 ? `... +${report.criticalErrors.length - 40} more` : ''
    ].join('\n');
    alert(msg);
    throw new Error(msg);
  }
  if (report.warnings && report.warnings.length) {
    for (const w of report.warnings) diag.warn('VALIDATION_WARNING', w);
  }

  // --- Stores ---
// IMPORTANT: menu must render even if asset preloads or runtime init fails (file://, missing assets, etc.)
let assets = null;
let visuals = null;
let spawns = null;

// Content is the only dependency for the menu lists.
const content = await new ContentStore({ loadJSON, diagnostics: diag, assetStore: null }).init();
const mutations = new MutationSystem({ contentStore: content, diagnostics: diag });

  // --- Local prefs (persistence) ---
  const LS = {
    lastUsedCharacterId: 'wl.lastUsedCharacterId',
    favoriteCharacterId: 'wl.favoriteCharacterId',
    muteAll: 'wl.muteAll',
    reducedMotion: 'wl.reducedMotion',
    minimalChrome: 'wl.minimalChrome',
    lowVfx: 'wl.lowVfx',
    screenshake: 'wl.screenshake',
    reducedFlashes: 'wl.reducedFlashes',
    allowFitBelow1: 'wl.allowFitBelow1',
    profileV1: 'wl.profile.v1'
  };
  const prefs = {
    get(k, fallback=null){ try{ const v = localStorage.getItem(k); return (v===null||v===undefined) ? fallback : v; }catch{ return fallback; } },
    set(k, v){ try{ if (v===null||v===undefined) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); }catch{} }
  };

// --- Profile store (Mastery stats, per-creature) ---
const profileStore = {
  load(){
    try { return JSON.parse(prefs.get(LS.profileV1, '{}') || '{}') || {}; } catch { return {}; }
  },
  save(p){
    try { prefs.set(LS.profileV1, JSON.stringify(p || {})); } catch {}
  },
  getCreature(p, creatureId){
    if (!p.creatures) p.creatures = {};
    if (!p.creatures[creatureId]) {
      p.creatures[creatureId] = {
        runs: 0, wins: 0, playtimeSec: 0,
        damageDealt: 0, damageTaken: 0,
        kills: 0, deaths: 0, bossKills: 0,
        longestSurvivalSec: 0, highestLevel: 1,
        topNodes: {}, // nodeId -> count
        lastPlayedAt: 0
      };
    }
    return p.creatures[creatureId];
  }
};
  // --- Net config + Online Lobby (WebRTC MVP) ---
  const NET_BUILD_VERSION = 'alpha-0.1.0';

  const NET_DEFAULT = {
    signalingUrl: 'ws://localhost:8787',
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302'] },
      {
        urls: [
          'turn:YOUR_TURN_HOST:3478?transport=udp',
          'turn:YOUR_TURN_HOST:3478?transport=tcp'
        ],
        username: '${ENV_TURN_USER}',
        credential: '${ENV_TURN_PASS}'
      }
    ],
    iceTransportPolicy: 'all',
    netMode: 'webrtc_p2p',
    maxPlayersCoop: 4,
    maxPlayersPvp: 2
  };
  async function loadNetConfig(){
    let cfg = { ...NET_DEFAULT };
    try {
      const j = await loadJSON('data/net/net_config.json');
      if (j && typeof j === 'object') cfg = { ...cfg, ...j };
    } catch(_) {}

    const qs = new URLSearchParams(location.search);
    const ov = qs.get('signal');
    if (ov) cfg.signalingUrl = ov;
    const nm = qs.get('netMode');
    if (nm) cfg.netMode = nm;

    const turnUser = qs.get('turnUser') || prefs.get('NET_TURN_USER','');
    const turnPass = qs.get('turnPass') || prefs.get('NET_TURN_PASS','');
    const ice = Array.isArray(cfg.iceServers) ? cfg.iceServers : [];
    let hasTurn = false;
    for (const srv of ice) {
      if (!srv || typeof srv !== 'object') continue;
      const urls = Array.isArray(srv.urls) ? srv.urls : [srv.urls].filter(Boolean);
      const isTurn = urls.some(u => String(u||'').startsWith('turn:'));
      if (!isTurn) continue;
      hasTurn = true;
      if (String(srv.username||'').startsWith('${ENV_')) srv.username = turnUser || '';
      if (String(srv.credential||'').startsWith('${ENV_')) srv.credential = turnPass || '';
    }
    cfg.iceServers = ice;
    if (hasTurn) {
      const ok = ice.some(s => {
        const urls = Array.isArray(s?.urls) ? s.urls : [s?.urls].filter(Boolean);
        const isTurn = urls.some(u => String(u||'').startsWith('turn:'));
        return isTurn && s.username && s.credential;
      });
      if (!ok && !window.__WL_TURN_WARNED) {
        window.__WL_TURN_WARNED = true;
        diag?.warn?.('TURN_MISSING_CREDS', { hint:'Set via ?turnUser&turnPass or localStorage NET_TURN_USER/NET_TURN_PASS' });
      }
    }

    const join = qs.get('join');
    const mode = qs.get('mode');
    if (join) cfg._autoJoin = { code: String(join).toUpperCase(), mode: (mode||'coop') };

    return cfg;
  }

  const net = {
    state: 'OFFLINE',
    role: 'offline', // offline | host | client
    mode: null, // coop|pvp
    cfg: null,
    ws: null,
    lobbyCode: null,
    playerId: null,
    reconnectToken: null,
    peers: new Map(), // playerId -> { pc, dcR, dcU, lastHeard, status, ghostUntil, pingMs, retriedRelay }
    _clientPeer: null,
    _inputSeq: 0,
    _remoteInput: null,
    _snapT: 0,
    _snapInterval: 1/15,
    _lastSnap: null,
    _wantStart: false,
    _eventId: 0,
    _hostTick: 0,
    _clockOffsetMs: 0,
    _clockAlpha: 0.12,
    _lastFullSnapMs: 0,
    _forceFullSnap: false,
    _pingMs: null
  };

  function netUIEnsure(){
    if (document.getElementById('netOverlay')) return;
    const wrap = document.createElement('div');
    wrap.id = 'netOverlay';
    wrap.className = 'netOverlay hidden';
    wrap.innerHTML = `
      <div class="netPanel">
        <div class="netTitle">ONLINE LOBBY</div>
        <div class="netRow"><span class="netLabel">Mode</span><span id="netMode" class="netValue">—</span></div>
        <div class="netRow"><span class="netLabel">Lobby Code</span><span id="netCode" class="netValue">—</span></div>
        <div class="netRow"><span class="netLabel">Players</span><span id="netRoster" class="netValue">—</span></div>
        <div class="netActions">
          <button id="netCopy" class="btnPrimary" type="button">Copy Code</button>
          <button id="netJoinLink" class="btnPrimary" type="button">Copy Join URL</button>
          <button id="netStart" class="btnPrimary" type="button">START MATCH</button>
          <button id="netBack" class="btnPrimary" type="button">Back</button>
        </div>
        <div id="netStatus" class="netStatus">—</div>
      </div>
    `;
    document.body.appendChild(wrap);
    const elCopy = document.getElementById('netCopy');
    const elJoinLink = document.getElementById('netJoinLink');
    const elBack = document.getElementById('netBack');
    const elStart = document.getElementById('netStart');

    elCopy.addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText(String(net.lobbyCode||'')); toast('Copied lobby code'); }catch{ toast('Copy failed'); } });
    elJoinLink.addEventListener('click', async ()=>{
      try{
        const u = new URL(location.href);
        u.searchParams.set('join', String(net.lobbyCode||''));
        const s = u.toString();
        await navigator.clipboard.writeText(s);
        toast('Copied join URL');
      }catch{ toast('Copy failed'); }
    });
    elBack.addEventListener('click', ()=>{ netLeaveToMenu(); });
    elStart.addEventListener('click', ()=>{ if (net.role==='host'){ net._wantStart = true; netBroadcast({ t:'start', mode: net.mode, menuSel }); startRun(); } });
    // AUTOJOIN via invite link (?join=CODE). Fail-soft; offline remains available.
    setTimeout(async ()=>{
      try{
        if (!net.cfg) net.cfg = await loadNetConfig();
        if (net.cfg && net.cfg._autoJoin && net.role==='offline') {
          const code = net.cfg._autoJoin.code;
          net.cfg._autoJoin = null;
          netJoin(code);
        }
      }catch{}
    }, 0);
  }

  function netUIShow(show){
    netUIEnsure();
    const el = document.getElementById('netOverlay');
    if (!el) return;
    el.classList.toggle('hidden', !show);
  }
  function netUISet(status){
    const elMode = document.getElementById('netMode');
    const elCode = document.getElementById('netCode');
    const elRoster = document.getElementById('netRoster');
    const elStatus = document.getElementById('netStatus');
    const elStart = document.getElementById('netStart');
    if (elMode) elMode.textContent = (net.mode||'—').toUpperCase();
    if (elCode) elCode.textContent = net.lobbyCode||'—';
    if (elRoster){
      const n = (net.role==='host') ? (1 + net.peers.size) : (net.role==='client' ? 2 : 1);
      elRoster.textContent = `${n} connected`;
    }
    if (elStatus) elStatus.textContent = status||'';
    if (elStart) elStart.style.display = (net.role==='host') ? 'inline-flex' : 'none';
  }

  function netLeaveToMenu(){
    try{ netClose(); }catch{}
    netUIShow(false);
    showScreen('main');
  }

  function netClose(){
    try{ net.ws?.close(); }catch{}
    net.ws = null;
    try{ if (net._pingTimer) { clearInterval(net._pingTimer); net._pingTimer = null; } }catch{}
    for (const p of net.peers.values()){
      try{ p.dc?.close(); }catch{}
      try{ p.pc?.close(); }catch{}
    }
    net.peers.clear();
    net.role = 'offline';
    net.mode = null;
    net.lobbyCode = null;
    net.peerId = null;
    net._remoteInput = null;
    net._lastSnap = null;
    net._wantStart = false;
  }

  async function netConnectSignal(){
    if (net.ws && net.ws.readyState === 1) return;
    net.cfg = net.cfg || await loadNetConfig();
    return new Promise((resolve, reject)=>{
      const ws = new WebSocket(net.cfg.signalingUrl);
      net.ws = ws;
      ws.onopen = ()=>resolve();
      ws.onerror = (e)=>reject(e);
      ws.onmessage = (ev)=>{ try{ netOnSignal(JSON.parse(ev.data)); }catch{} };
      ws.onclose = ()=>{ /* fail-soft */ if (net.role!=='offline') { netUISet('Signal disconnected — offline mode available'); } };
    });
  }

  function netSendSignal(obj){
    try{ if (net.ws && net.ws.readyState===1) net.ws.send(JSON.stringify(obj)); }catch{}
  }

  async function netHost(mode){
    netClose();
    net.mode = mode;
    net.role = 'host';
    pendingMode = (mode === 'pvp') ? 'pvp_aim' : 'coop_auto';
    netUIShow(true);
    netUISet('Connecting…');
    try{
      await netConnectSignal();
      netSendSignal({ type:'createLobby', mode, maxPlayers: (mode==='pvp' ? (net.cfg?.maxPlayersPvp||2) : (net.cfg?.maxPlayersCoop||4)), version: NET_BUILD_VERSION });
    }catch(e){
      netClose();
      netUIShow(false);
      toast('Online unavailable — starting offline');
      goPlaySetup(mode==='pvp'?'pvp_aim':'coop_auto');
    }
  }

  async function netJoin(code){
    netClose();
    net.mode = 'coop';
    net.role = 'client';
    pendingMode = 'coop_auto';
    netUIShow(true);
    netUISet('Connecting…');
    try{
      await netConnectSignal();
      (function(){
      const c = String(code||'').toUpperCase();
      const key = `NET_RECON_${c}`;
      let rec = null;
      try{ rec = JSON.parse(prefs.get(key,'')||''); }catch{}
      const payload = { type:'joinLobby', lobbyCode: c, version: NET_BUILD_VERSION };
      if (rec && rec.playerId && rec.reconnectToken && rec.expiresAt && rec.expiresAt > Date.now()) {
        payload.playerId = rec.playerId;
        payload.reconnectToken = rec.reconnectToken;
      }
      netSendSignal(payload);
    })();
    }catch(e){
      netClose();
      netUIShow(false);
      toast('Online unavailable — offline mode');
      showScreen('main');
    }
  }

  function netOnSignal(msg){
    const t = msg?.type;
    if (t === 'createLobbyResult'){
      if (!msg.ok){ netUISet('Create lobby failed'); return; }
      net.lobbyCode = msg.lobbyCode;
      net.playerId = msg.playerId || null;
      net.reconnectToken = msg.reconnectToken || null;
      net.state = 'CONNECTING';
      try{
        const key = `NET_RECON_${String(net.lobbyCode||'')}`;
        prefs.set(key, JSON.stringify({ playerId: net.playerId, reconnectToken: net.reconnectToken, expiresAt: Date.now() + 60_000 }));
      }catch{}
      netUISet('Lobby created. Share code.');
      return;
    }
    if (t === 'joinLobbyResult'){
      if (!msg.ok){
        if (msg.error === 'version_mismatch') netUISet(`Version mismatch (host ${msg.hostVersion||'?'}, you ${msg.clientVersion||'?'})`);
        else netUISet('Join failed');
        return;
      }
      net.lobbyCode = msg.lobbyCode;
      net.playerId = msg.playerId || null;
      net.reconnectToken = msg.reconnectToken || null;
      net.mode = msg.mode || net.mode;
      net.state = 'CONNECTING';
      try{
        const key = `NET_RECON_${String(net.lobbyCode||'')}`;
        prefs.set(key, JSON.stringify({ playerId: net.playerId, reconnectToken: net.reconnectToken, expiresAt: Date.now() + 60_000 }));
      }catch{}
      netUISet(msg.resumed ? 'Rejoined. Resuming…' : 'Joined. Waiting for host…');
      return;
    }
    if (t === 'peerRejoined' && net.role==='host'){
      const peerId = msg.playerId;
      netUISet('Peer rejoined — negotiating…');
      net._forceFullSnap = true;
      netHostCreatePeer(peerId);
      return;
    }
    if (t === 'peerJoined' && net.role==='host'){
      const peerId = msg.playerId;
      netUISet('Peer joined — negotiating…');
      netHostCreatePeer(peerId);
      return;
    }
    if (t === 'peerLeft' && net.role==='host'){
      const peerId = msg.playerId;
      const p = net.peers.get(peerId);
      if (p){
        p.status = 'reconnecting';
        p.ghostUntil = Date.now() + 60_000;
        try{ p.dcR?.close(); }catch{}
        try{ p.dcU?.close(); }catch{}
        try{ p.pc?.close(); }catch{}
        // Keep slot for 60s; evict if not rejoined.
        setTimeout(()=>{
          const pp = net.peers.get(peerId);
          if (pp && pp.status==='reconnecting' && Date.now() > (pp.ghostUntil||0)) {
            net.peers.delete(peerId);
          }
        }, 60_500);
      }
      netUISet('Peer disconnected — waiting 60s…');
      return;
    }
    if (t === 'relayFromPeer' && net.role==='host'){
      netHostHandlePeerSignal(msg.playerId, msg.payload);
      return;
    }
    if (t === 'relayFromHost' && net.role==='client'){
      netClientHandleHostSignal(msg.payload);
      return;
    }
  }

  function netMakePC(isHost){
    const policy = (net.cfg?.netMode === 'webrtc_relayed') ? 'relay' : (net.cfg?.iceTransportPolicy || NET_DEFAULT.iceTransportPolicy || 'all');
    const pc = new RTCPeerConnection({ iceServers: net.cfg?.iceServers || NET_DEFAULT.iceServers, iceTransportPolicy: policy });
    return pc;
  }

  async function netHostCreatePeer(peerId){
    const existing = net.peers.get(peerId);
    if (existing && existing.status === 'connected') return;
    if (existing){ try{ existing.dcR?.close(); }catch{} try{ existing.dcU?.close(); }catch{} try{ existing.pc?.close(); }catch{} net.peers.delete(peerId); }
    const pc = netMakePC(true);
    const dcR = pc.createDataChannel('wl_r', { ordered:true });
    const dcU = pc.createDataChannel('wl_u', { ordered:false, maxRetransmits: 0 });
    const peer = { pc, dcR, dcU, lastHeard: performance.now(), status:'connecting', ghostUntil:0, pingMs:null, retriedRelay:false };
    net.peers.set(peerId, peer);

    dcR.onopen = ()=>{ peer.status='connected'; net.state='CONNECTED'; netUISet('Connected. Press START MATCH.'); };
    // Connection timeout + relay retry for strict NAT
    setTimeout(()=>{
      if (peer.status!=='connected' && !peer.retriedRelay) {
        peer.retriedRelay = true;
        netUISet('NAT strict, retrying relay…');
        try{ peer.pc?.close(); }catch{}
        net.cfg.netMode = 'webrtc_relayed';
        netHostCreatePeer(peerId);
      }
    }, 12000);
    dcR.onclose = ()=>{ peer.status='disconnected'; netUISet('Peer disconnected'); };
    dcR.onmessage = (ev)=>{ netOnDataFromClient(peerId, ev.data); };
    dcU.onmessage = (ev)=>{ netOnDataFromClient(peerId, ev.data); };

    pc.onicecandidate = (ev)=>{
      if (ev.candidate) netSendSignal({ type:'relayToPeer', lobbyCode: net.lobbyCode, playerId: peerId, payload: { t:'candidate', c: ev.candidate } });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    netSendSignal({ type:'relayToPeer', lobbyCode: net.lobbyCode, playerId: peerId, payload: { t:'offer', sdp: offer } });
    netUISet('Negotiating…');
  }

  async function netHostHandlePeerSignal(peerId, payload){
    const peer = net.peers.get(peerId);
    if (!peer) return;
    const pc = peer.pc;
    const t = payload?.t;
    try{
      if (t === 'answer'){
        await pc.setRemoteDescription(payload.sdp);
        return;
      }
      if (t === 'candidate' && payload.c){
        await pc.addIceCandidate(payload.c);
        return;
      }
    }catch(_){ }
  }

  async function netClientHandleHostSignal(payload){
    const t = payload?.t;
    if (!t) return;
    if (!net._clientPeer){
      const pc = netMakePC(false);
      net._clientPeer = { pc, dcR:null, dcU:null };
      pc.onicecandidate = (ev)=>{
        if (ev.candidate) netSendSignal({ type:'relayToHost', lobbyCode: net.lobbyCode, payload: { t:'candidate', c: ev.candidate } });
      };
      pc.ondatachannel = (ev)=>{
        const dc = ev.channel;
        if (dc.label === 'wl_u') net._clientPeer.dcU = dc; else net._clientPeer.dcR = dc;
        dc.onopen = ()=>{ net.state='CONNECTED'; netUISet('Connected. Waiting for START…');
          if (!net._pingTimer) {
            net._pingTimer = setInterval(()=>{
              try{
                const dc = net._clientPeer?.dcR;
                if (dc && dc.readyState==='open') dc.send(JSON.stringify({ t:'ping', ct: Date.now() }));
              }catch{}
            }, 2000);
          } };
        dc.onclose = ()=>{
          if (net.role==='client' && net.lobbyCode){
            net.state='RECONNECTING';
            netUIShow(true);
            netUISet('Paused — Reconnecting…');
            // Attempt resume for 60s; token is stored in localStorage.
            setTimeout(()=>{ try{ netJoin(net.lobbyCode); }catch{} }, 250);
          }
        };
        dc.onmessage = (ev2)=>{ netOnDataFromHost(ev2.data); };
      };
    }
    const pc = net._clientPeer.pc;
    try{
      if (t === 'offer'){
        await pc.setRemoteDescription(payload.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        netSendSignal({ type:'relayToHost', lobbyCode: net.lobbyCode, payload: { t:'answer', sdp: ans } });
      }
      if (t === 'candidate' && payload.c){
        await pc.addIceCandidate(payload.c);
      }
    }catch(_){}
  }

  function netSendToHost(obj){
    const dc = (net._clientPeer?.dcU || net._clientPeer?.dcR);
    if (!dc || dc.readyState !== 'open') return;
    try{ dc.send(JSON.stringify(obj)); }catch{}
  }
  function netBroadcast(obj, { reliable=false } = {}){
    const s = JSON.stringify(obj);
    for (const [peerId, peer] of net.peers){
      const dc = reliable ? peer.dcR : (peer.dcU || peer.dcR);
      try{ if (dc && dc.readyState==='open') dc.send(s); }catch{}
    }
  }

  function buildInputPacket(){
    // Normalize aim to world coords; client uses last known player position from snapshots.
    const mv = getMoveVector();
    return {
      t:'input',
      seq: ++net._inputSeq,
      mvx: mv.x, mvy: mv.y,
      aimx: mouse.x, aimy: mouse.y,
      fire: !!mouse.down
    };
  }
  function getMoveVector(){
    let mx = 0, my = 0;
    if (keys.has('w') || keys.has('arrowup')) my -= 1;
    if (keys.has('s') || keys.has('arrowdown')) my += 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    // touch movement
    if (touchCtl.moveId !== null){
      mx += clamp(touchCtl.moveVec.x / 42, -1, 1);
      my += clamp(touchCtl.moveVec.y / 42, -1, 1);
    }
    const l = Math.hypot(mx,my) || 1;
    if (l > 1) { mx/=l; my/=l; }
    return { x: mx, y: my };
  }

  function netOnDataFromClient(peerId, data){
    let msg; try{ msg = JSON.parse(data); }catch{ return; }
    const peer = net.peers.get(peerId);
    if (peer) peer.lastHeard = performance.now();

    if (msg.t === 'ping'){
      // respond on reliable lane
      const p = net.peers.get(peerId);
      try{ if (p?.dcR && p.dcR.readyState==='open') p.dcR.send(JSON.stringify({ t:'pong', ct: msg.ct||0, ht: Date.now() })); }catch{}
      return;
    }

    if (msg.t === 'input'){
      const mvx = Number(msg.mvx||0);
      const mvy = Number(msg.mvy||0);
      const mag = Math.hypot(mvx, mvy);
      msg.mvx = (mag>1.0) ? (mvx/mag) : mvx;
      msg.mvy = (mag>1.0) ? (mvy/mag) : mvy;
      // fire <= 15/s
      if (peer){
        const t = performance.now();
        peer._lastFireT = peer._lastFireT || 0;
        if (msg.fire && (t - peer._lastFireT) < 66) msg.fire = false;
        if (msg.fire) peer._lastFireT = t;
      }
      net._remoteInput = msg;
      return;
    }
  }

function netOnDataFromHost(data){
    let msg; try{ msg = JSON.parse(data); }catch{ return; }
    if (msg.t === 'start'){
      // Host selected menu; follow it.
      try{ if (msg.menuSel) menuSel = { ...menuSel, ...msg.menuSel }; }catch{}
      pendingMode = (msg.mode === 'pvp') ? 'pvp_aim' : 'coop_auto';
      netUIShow(false);
      startRun();
      return;
    }
    if (msg.t === 'pong'){
      net._pingMs = Math.max(0, Date.now() - (msg.ct||Date.now()));
      return;
    }
    if (msg.t === 'snap'){
      if (typeof msg.hostTimeMs === 'number') {
        const off = msg.hostTimeMs - Date.now();
        net._clockOffsetMs = net._clockOffsetMs * (1 - net._clockAlpha) + off * net._clockAlpha;
      }
      net._lastSnap = msg;
      return;
    }
  }




  // Net snapshot helpers (host-authoritative MVP)
  function netPackPlayer(p){
    if (!p) return null;
    return {
      x: p.x, y: p.y, vx: p.vx||0, vy: p.vy||0,
      hp: p.hp, maxHp: p.maxHp, dir: p.dir||0,
      creatureId: p.creatureId||null
    };
  }
  function netPackEnemy(e){
    return { id: e._id||0, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, r: e.r, spriteId: e.spriteId, ai: e.ai };
  }
  function netPackProj(pr){
    return { id: pr._id||0, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, life: pr.life, dmg: pr.dmg, owner: pr.owner };
  }
  let _netNextEid = 1;
  function netEnsureIds(){
    for (const e of enemies){ if (!e._id) e._id = _netNextEid++; }
    for (const pr of projectiles){ if (!pr._id) pr._id = _netNextEid++; }
    for (const g of xpGems){ if (!g._id) g._id = _netNextEid++; }
  }
  function netHostMaybeSendSnapshot(dt){
    if (net.role !== 'host' || net.peers.size === 0) return;
    net._snapT += dt;
    if (net._snapT < net._snapInterval) return;
    net._snapT = 0;
    try{
      netEnsureIds();
      net._hostTick = (net._hostTick||0) + 1;
      const nowMs = Date.now();
      const wantFull = (!net._lastFullSnapMs) || (nowMs - net._lastFullSnapMs > 5000) || !!net._forceFullSnap;
      if (wantFull) { net._lastFullSnapMs = nowMs; net._forceFullSnap = false; }
      const snap = {
        t:'snap',
        full: !!wantFull,
        tickId: net._hostTick,
        hostTimeMs: nowMs,
        tm: performance.now(),
        mode: runMode,
        p1: netPackPlayer(player),
        p2: netPackPlayer(player2),
        enemies: enemies.slice(0, 140).map(netPackEnemy),
        projs: projectiles.slice(0, 220).map(netPackProj),
        xp, xpToNext, level, runTimeSec,
        boss: boss ? { x: boss.x, y: boss.y, hp: boss.hp, maxHp: boss.maxHp, r: boss.r, sheetId: boss.sheetId } : null
      };
      netBroadcast(snap, { reliable:false });
    }catch(_){ }
  }

  function netClientApplySnapshot(){
    const snap = net._lastSnap;
    if (!snap || net.role !== 'client') return;
    // Host is p1; client is p2 for HUD purposes.
    if (snap.p2){
      if (!player) player = { ...snap.p2 };
      Object.assign(player, snap.p2);
    }
    if (snap.p1){
      if (!player2) player2 = { ...snap.p1 };
      else Object.assign(player2, snap.p1);
    }
    if (Array.isArray(snap.enemies)){
      enemies = snap.enemies.map(e=>({ ...e, r: e.r||22, speed: 0, t: 0, contactDamage: 0, shootCd: 0, dashCd: 0, dashT: 0, poisonCd:0 }));
    }
    if (Array.isArray(snap.projs)){
      projectiles = snap.projs.map(pr=>({ ...pr }));
    }
    if (typeof snap.xp === 'number') xp = snap.xp;
    if (typeof snap.xpToNext === 'number') xpToNext = snap.xpToNext;
    if (typeof snap.level === 'number') level = snap.level;
    if (typeof snap.runTimeSec === 'number') runTimeSec = snap.runTimeSec;
    if (snap.boss){
      if (!boss) boss = { ...snap.boss, t: 0, speed: 0, scale: 2.0 };
      else Object.assign(boss, snap.boss);
    } else {
      boss = null;
      bossZoomMul = 1.0;
    }
  }

  // --- Minimal audio (uses existing wav assets; respects mute) ---
  const audio = {
    _ctx: null,
    _buf: new Map(),
    _els: new Map(),
    _warnedFileScheme: false,
    muted: false,
    async init(){
      this.muted = prefs.get(LS.muteAll,'0') === '1';
      if (elToggleMute) elToggleMute.checked = this.muted;
      // Lazy context: create on first user interaction.
    },
    async _ensure(){
      if (this._ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this._ctx = new AC();
      // Some browsers require an explicit user gesture to start audio.
      // We'll attempt to resume on-demand; callers should also rely on unlock hooks.
      try{ if (this._ctx.state === 'suspended') await this._ctx.resume(); }catch{}
    },
    async unlock(){
      await this._ensure();
      try{ if (this._ctx && this._ctx.state === 'suspended') await this._ctx.resume(); }catch{}
    },
    async _load(url){
      if (this._buf.has(url)) return this._buf.get(url);
      await this._ensure();
      if (!this._ctx) return null;
      // When opened via file://, fetch() is blocked by most browsers.
      // In that case we fall back to HTMLAudioElement playback (see play()).
      if (location && location.protocol === 'file:') return null;
      const res = await fetch(url, { cache: 'force-cache' });
      const arr = await res.arrayBuffer();
      const buf = await this._ctx.decodeAudioData(arr);
      this._buf.set(url, buf);
      return buf;
    },
    async play(url, { volume=0.25 } = {}){
      if (this.muted) return;
      // If the game is opened directly from disk, use <audio> so file:// works.
      if (location && location.protocol === 'file:'){
        if (!this._warnedFileScheme){
          this._warnedFileScheme = true;
          try{ toast('Tip: use the included start_server script for full audio support (file:// blocks some APIs).'); }catch{}
        }
        try{
          let el = this._els.get(url);
          if (!el){
            el = new Audio(url);
            el.preload = 'auto';
            this._els.set(url, el);
          }
          el.volume = Math.max(0, Math.min(1, volume));
          await el.play();
        }catch{}
        return;
      }
      await this._ensure();
      if (!this._ctx) return;
      const buf = await this._load(url);
      if (!buf) return;
      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      const gain = this._ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain).connect(this._ctx.destination);
      src.start(0);
    },
    async beep({ freq=440, dur=0.06, type='sine', volume=0.05, attack=0.004, release=0.03 } = {}){
      if (this.muted) return;
      await this._ensure();
      if (!this._ctx) return;
      const t0 = this._ctx.currentTime;
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack + 0.01, dur));
      osc.connect(gain).connect(this._ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + release);
    },
    setMuted(v){
      this.muted = !!v;
      prefs.set(LS.muteAll, this.muted ? '1':'0');
    }
  };

  // Global audio unlock: resume AudioContext after a user gesture.
  // Keeps Firefox/Safari from spamming "AudioContext was prevented" warnings.
  (function installAudioUnlock(){
    let done = false;
    const unlock = async ()=>{
      if (done) return;
      done = true;
      try{ await audio.unlock(); }catch{}
    };
    window.addEventListener('pointerdown', unlock, { passive: true, once: true });
    window.addEventListener('keydown', unlock, { passive: true, once: true });
  })();

  // --- Canvas integer scaling (pixel-perfect) ---
  function applyIntegerScale(){
    const host = document.getElementById('gameHost') || document.body;
    // Use the host box so we automatically subtract any visible chrome.
    const availW = host.clientWidth || document.documentElement.clientWidth;
    const availH = host.clientHeight || document.documentElement.clientHeight;
    const raw = Math.min(availW / canvas.width, availH / canvas.height);

    // Strict integer scaling by default (pixel-perfect).
    // If the viewport is smaller than 1×, allow a non-integer fit ONLY when enabled.
    const allowFit = (prefs.get(LS.allowFitBelow1,'0') === '1');
    let s;
    if (raw >= 1) s = Math.max(1, Math.floor(raw));
    else s = allowFit ? Math.max(0.25, raw) : 1;

    canvas.style.width = `${canvas.width * s}px`;
    canvas.style.height = `${canvas.height * s}px`;
    // Surface info for the main menu footer.
    if (elMMFooterRight) elMMFooterRight.textContent = `Scale: ${s.toFixed(s>=1?0:2)}x · ${canvas.width}×${canvas.height}`;
  }
  window.addEventListener('resize', applyIntegerScale);
  applyIntegerScale();

// Lazy runtime init (only needed once you actually start the run).
async function ensureRuntime() {
  if (assets && visuals && spawns) return;
  assets = await new AssetStore({ loadJSON, diagnostics: diag }).init();
  // Pixel Upgrade Engine toggle (Bible-driven via asset tags)
  if (elTogglePixel) {
    assets.setUpgradeEnabled(!!elTogglePixel.checked);
    elTogglePixel.addEventListener('change', () => {
      assets.setUpgradeEnabled(!!elTogglePixel.checked);
      location.reload();
    });
  }
  visuals = await new VisualAssembler({ assetStore: assets, contentStore: content, diagnostics: diag, loadJSON }).init();
  spawns = new SpawnDirector({ contentStore: content, assetStore: assets, diagnostics: diag });
  spawns.initEnemyCatalog();

  // Do not block menu rendering on preload; missing assets should not blank the UI.
  assets.preloadLaunch().catch((e) => diag.warn('PRELOAD_LAUNCH_FAILED', { error: String(e) }));
}

  // --- Input ---
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false };

  // Touch controls (Safari/iOS friendly; works inside itch.io iframes)
  // Left side: movement stick. Right side: aim/fire (hold).
  const touchCtl = {
    moveId: null,
    aimId: null,
    moveStart: { x: 0, y: 0 },
    moveStartN: { x: 0, y: 0 },
    moveNowN: { x: 0, y: 0 },
    moveVec: { x: 0, y: 0 },
    aimPos: { x: 0, y: 0 },
    aimDown: false
  };
  function canvasPointFromClient(clientX, clientY){
    const r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (canvas.width / r.width),
      y: (clientY - r.top) * (canvas.height / r.height),
      rx: (clientX - r.left) / r.width,
      ry: (clientY - r.top) / r.height,
      rect: r
    };
  }

  // Camera zoom (zoom < 1 = zoom out). Wheel or +/- to adjust.
  let zoom = 1.0;
  function setZoom(z) { zoom = clamp(z, 0.5, 2.0); }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (e.key === ' ') e.preventDefault();
    if (k === 'escape') {
      // Close mutation choice overlay if open.
      if (!elOverlay.classList.contains('hidden')) {
        hideOverlay();
        return;
      }
      // In-run: toggle pause / resume.
      if (uiScreen === 'ingame' && running) {
        if (gamePaused) hidePause();
        else showPause();
        e.preventDefault();
        return;
      }
    }
    if (k === 'r') restartRun();
    // Debug: spawn/clear boss for parity smoke-test
    if (k === 'b') toggleBoss();
    // Zoom controls
    if (k === '+' || k === '=') setZoom(zoom * 1.1);
    if (k === '-' || k === '_') setZoom(zoom / 1.1);
    if (k === '0') setZoom(1.0);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
    mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
  });

  // Zoom with mouse wheel (works on desktop). Hold Ctrl/Meta to prevent page zoom from stealing the wheel.
  canvas.addEventListener('wheel', (e) => {
    // If browser is trying to page-zoom, prevent it so we can zoom the camera instead.
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    if (dir > 0) setZoom(zoom / 1.12);
    else if (dir < 0) setZoom(zoom * 1.12);
  }, { passive: false });
  canvas.addEventListener('mousedown', () => (mouse.down = true));
  window.addEventListener('mouseup', () => (mouse.down = false));

  // Touch: prevent the browser from scrolling/zooming the iframe while playing.
  // Use touch events (not just pointer) for Safari reliability.
  canvas.addEventListener('touchstart', (e) => {
    if (!e.changedTouches) return;
    for (const t of Array.from(e.changedTouches)){
      const p = canvasPointFromClient(t.clientX, t.clientY);
      if (touchCtl.moveId === null && p.rx < 0.48){
        touchCtl.moveId = t.identifier;
        touchCtl.moveStart.x = p.x; touchCtl.moveStart.y = p.y;
        touchCtl.moveStartN.x = p.rx; touchCtl.moveStartN.y = p.ry;
        touchCtl.moveNowN.x = p.rx; touchCtl.moveNowN.y = p.ry;
        touchCtl.moveVec.x = 0; touchCtl.moveVec.y = 0;
      } else if (touchCtl.aimId === null){
        touchCtl.aimId = t.identifier;
        touchCtl.aimPos.x = p.x; touchCtl.aimPos.y = p.y;
        touchCtl.aimDown = true;
        // Also mirror into mouse aim so existing aim code paths work.
        mouse.x = p.x; mouse.y = p.y;
        mouse.down = true;
      }
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (!e.changedTouches) return;
    for (const t of Array.from(e.changedTouches)){
      const p = canvasPointFromClient(t.clientX, t.clientY);
      if (touchCtl.moveId === t.identifier){
        const dx = p.x - touchCtl.moveStart.x;
        const dy = p.y - touchCtl.moveStart.y;
        const max = 42;
        const len = Math.hypot(dx, dy) || 1;
        const s = Math.min(1, max / len);
        touchCtl.moveVec.x = dx * s;
        touchCtl.moveVec.y = dy * s;
        touchCtl.moveNowN.x = p.rx; touchCtl.moveNowN.y = p.ry;
      }
      if (touchCtl.aimId === t.identifier){
        touchCtl.aimPos.x = p.x; touchCtl.aimPos.y = p.y;
        mouse.x = p.x; mouse.y = p.y;
      }
    }
    e.preventDefault();
  }, { passive: false });

  function endTouchById(id){
    if (touchCtl.moveId === id){
      touchCtl.moveId = null;
      touchCtl.moveVec.x = 0; touchCtl.moveVec.y = 0;
      touchCtl.moveStartN.x = 0; touchCtl.moveStartN.y = 0;
      touchCtl.moveNowN.x = 0; touchCtl.moveNowN.y = 0;
    }
    if (touchCtl.aimId === id){
      touchCtl.aimId = null;
      touchCtl.aimDown = false;
      mouse.down = false;
    }
  }
  canvas.addEventListener('touchend', (e) => {
    if (!e.changedTouches) return;
    for (const t of Array.from(e.changedTouches)) endTouchById(t.identifier);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchcancel', (e) => {
    if (!e.changedTouches) return;
    for (const t of Array.from(e.changedTouches)) endTouchById(t.identifier);
    e.preventDefault();
  }, { passive: false });

  // --- Helpers ---
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  // Linear interpolation helper (used by contact-friction resolution).
  // Must exist in the bundled runtime for iOS Safari.
  function lerp(a, b, t){ return a + (b - a) * t; }
  function norm(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

  // --- Lightweight animated main menu scene (parallax + particles + showcase) ---
  class MenuScene {
    constructor(){
      this.t = 0;
      this.camBreath = 0;
      this.layers = { x0:0, x1:0, x2:0, x3:0 };
      this.stars = this._makeStars(140);
      this.leaves = [];
      this.leafPool = [];
      this.leafCap = 42;
      this._lastSpawn = 0;
      this._flicker = 0;
      this._showcaseImg = null;
      this._sheet = { img:null, w:64, h:64, cols:6, rows:5, scale:4 };
      this._frame = 0;
      this._frameT = 0;
      this._frameT = 0;
      this._dirRow = 0;
      this._flourish = 0;
    }

    setReducedMotion(v){
      this.leafCap = v ? 18 : 42;
      this.stars = this._makeStars(v ? 80 : 140);
    }

    _makeStars(n){
      const out = [];
      for (let i=0;i<n;i++){
        out.push({
          x: Math.random(),
          y: Math.random()*0.62,
          tw: Math.random()*0.9,
          s: (Math.random()<0.22)?2:1
        });
      }
      return out;
    }

    setShowcaseSheet(img){
      this._sheet.img = img || null;
      if (!img) return;

      // Auto-detect frame cell size from common sprite sheet sizes.
      const W = img.naturalWidth || img.width || 0;
      const H = img.naturalHeight || img.height || 0;

      const candidates = [96, 64, 48, 32];
      let best = null;
      for (const cell of candidates){
        if (cell <= 0) continue;
        if (W % cell !== 0 || H % cell !== 0) continue;
        const cols = W / cell;
        const rows = H / cell;
        if (cols < 3 || rows < 3) continue;
        // Prefer larger cells for readability; lightly prefer "character-ish" row counts.
        const score = cell * 10 + (rows >= 4 && rows <= 10 ? 5 : 0) + (cols >= 4 && cols <= 16 ? 5 : 0);
        if (!best || score > best.score) best = { cell, cols, rows, score };
      }
      if (!best){
        // Fallback: assume square cells using the smaller dimension divided by a reasonable count.
        const cell = Math.max(32, Math.min(96, Math.gcd ? Math.gcd(W,H) : 64));
        best = { cell, cols: Math.max(1, Math.floor(W / cell)), rows: Math.max(1, Math.floor(H / cell)) };
      }

      this._sheet.w = best.cell;
      this._sheet.h = best.cell;
      this._sheet.cols = best.cols;
      this._sheet.rows = best.rows;

      // Choose an integer scale that keeps the sprite readable but contained in the diorama.
      const maxH = Math.floor(canvas.height * 0.48);
      const maxW = Math.floor(canvas.width  * 0.34);
      const sH = Math.max(1, Math.floor(maxH / this._sheet.h));
      const sW = Math.max(1, Math.floor(maxW / this._sheet.w));
      this._sheet.scale = Math.max(2, Math.min(6, Math.min(sH, sW)));

      // Reset frame to avoid popping.
      this._frame = 0;
      this._flourish = 0;
    }

    triggerFlourish(){ this._flourish = 1.0; }

    _spawnLeaf(){
      const p = this.leafPool.pop() || { x:0,y:0,vx:0,vy:0,life:0,rot:0,w:2,h:1 };
      p.x = Math.random();
      p.y = -0.05;
      p.vx = (Math.random()*0.05) + 0.01;
      p.vy = (Math.random()*0.07) + 0.03;
      p.life = 1.0;
      p.rot = Math.random()*6.28;
      p.w = (Math.random()<0.6)?2:3;
      p.h = 1;
      this.leaves.push(p);
    }

    update(dt){
      this.t += dt;
      this.camBreath = Math.sin(this.t*0.20) * 1.0;
      const px = dt;
      this.layers.x0 = (this.layers.x0 + px*2) % 1;
      this.layers.x1 = (this.layers.x1 + px*5) % 1;
      this.layers.x2 = (this.layers.x2 + px*10) % 1;
      this.layers.x3 = (this.layers.x3 + px*18) % 1;

      this._flicker = 0.82 + Math.sin(this.t*6.0)*0.03 + (Math.random()*0.02);

      // Leaves
      this._lastSpawn += dt;
      const spawnEvery = (prefs.get(LS.reducedMotion,'0')==='1') ? 0.22 : 0.11;
      if (this._lastSpawn >= spawnEvery && this.leaves.length < this.leafCap){
        this._lastSpawn = 0;
        this._spawnLeaf();
      }
      for (let i=this.leaves.length-1;i>=0;i--){
        const p=this.leaves[i];
        p.x += p.vx*dt;
        p.y += p.vy*dt;
        p.rot += dt*2.0;
        p.life -= dt*0.22;
        if (p.y>1.1 || p.x>1.2 || p.life<=0){
          this.leaves.splice(i,1);
          this.leafPool.push(p);
        }
      }

      // Showcase anim
      this._frameT += dt;
      const speed = this._flourish>0 ? 0.07 : 0.12;
      if (this._frameT >= speed){
        this._frameT = 0;
        const maxFrames = Math.max(1, Math.min(this._sheet.cols|0, 6));
        this._frame = (this._frame + 1) % maxFrames;
      }
      this._flourish = Math.max(0, this._flourish - dt*0.8);
    }

    draw(ctx){
      if (!ctx) return;
      const w = canvas.width, h = canvas.height;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0,0,w,h);

      // Sky gradient
      const g = ctx.createLinearGradient(0,0,0,h);
      g.addColorStop(0,'#0b0b15');
      g.addColorStop(0.55,'#0c101a');
      g.addColorStop(1,'#08080e');
      ctx.fillStyle = g;
      ctx.fillRect(0,0,w,h);

      // Stars
      for (const s of this.stars){
        const tw = 0.55 + 0.45*Math.sin(this.t*2.1 + s.tw*12.0);
        ctx.globalAlpha = 0.55*tw;
        ctx.fillStyle = '#dbe7ff';
        const x = Math.floor(s.x*w);
        const y = Math.floor(s.y*h);
        ctx.fillRect(x,y,s.s,s.s);
      }
      ctx.globalAlpha = 1;

      const breath = this.camBreath;

      // Parallax silhouettes (mountains / treeline / foreground)
      this._drawSilhouette(ctx, { y: 0.46, height: 0.28, color: '#0f1424', par: this.layers.x0, wiggle: breath*0.12 });
      this._drawSilhouette(ctx, { y: 0.56, height: 0.30, color: '#0d1820', par: this.layers.x1, wiggle: breath*0.20, spikes:true });
      this._drawSilhouette(ctx, { y: 0.66, height: 0.36, color: '#0a1516', par: this.layers.x2, wiggle: breath*0.35, spikes:true, closer:true });

      // Ground plane + grass tiles (our actual asset)
      this._drawGround(ctx, breath);

      // Lantern glow accent (uses existing VFX sheet as a soft blob, but still pixelated)
      this._drawLantern(ctx, breath);

      // Leaves (drifting)
      ctx.fillStyle = '#d6b36a';
      for (const p of this.leaves){
        const x = Math.floor(p.x*w);
        const y = Math.floor(p.y*h);
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.fillRect(x,y,p.w,p.h);
      }
      ctx.globalAlpha = 1;

      // Showcase sprite (bottom-left)
      this._drawShowcase(ctx, breath);

      ctx.restore();
    }

    _drawSilhouette(ctx, { y, height, color, par, wiggle=0, spikes=false, closer=false }){
      const w = canvas.width, h = canvas.height;
      const baseY = Math.floor(h*y + wiggle);
      const H = Math.floor(h*height);
      const step = closer ? 28 : 40;
      const offs = Math.floor(par * step);
      ctx.fillStyle = color;
      for (let x=-step; x<w+step; x+=step){
        const px = x - offs;
        const peak = spikes ? Math.floor((Math.sin((x*0.08)+this.t*0.1)*0.5+0.5) * (closer?22:14)) : 0;
        ctx.fillRect(px, baseY-peak, step+2, H+peak);
      }
    }

    _drawGround(ctx, breath){
      const w = canvas.width, h = canvas.height;
      const y0 = Math.floor(h*0.73 + breath*0.25);
      ctx.fillStyle = '#07070b';
      ctx.fillRect(0, y0, w, h-y0);
      // Tile with grass.png if present (nearest neighbor)
      if (!this._grassImg) {
        const img = new Image();
        img.src = 'assets/grass.png';
        this._grassImg = img;
      }
      const img = this._grassImg;
      if (img && img.complete && img.naturalWidth){
        const tile = 64;
        const s = 1;
        const ty = y0 - 14;
        const xOff = Math.floor(this.layers.x3 * tile);
        for (let x=-tile; x<w+tile; x+=tile){
          ctx.drawImage(img, x - xOff, ty, tile*s, tile*s);
        }
      }
    }

    _drawLantern(ctx, breath){
      const w = canvas.width, h = canvas.height;
      const x = Math.floor(w*0.70);
      const y = Math.floor(h*0.67 + breath*0.30);
      const r = 26;
      ctx.globalAlpha = 0.35 * this._flicker;
      ctx.fillStyle = '#f5d27a';
      ctx.fillRect(x - r, y - r, r*2, r*2);
      ctx.globalAlpha = 1;
    }

    _drawShowcase(ctx, breath){
      const img = this._sheet.img;
      if (!img) return;

      const w = canvas.width, h = canvas.height;
      const groundY = Math.floor(h*0.73 + breath*0.25);

      const fw = this._sheet.w, fh = this._sheet.h;
      const cols = Math.max(1, this._sheet.cols|0);
      const rows = Math.max(1, this._sheet.rows|0);

      // Stable idle: row 0; flourish: prefer row 2 if it exists, else last row.
      const flourishRow = (rows > 2) ? 2 : (rows - 1);
      const row = (this._flourish > 0.01) ? flourishRow : 0;

      // Frame index must be clamped to the sheet's column count.
      const col = Math.max(0, Math.min(cols - 1, this._frame|0));

      const sx = col * fw;
      const sy = row * fh;

      const scale = (this._sheet.scale|0) || 4; // integer scale, crisp
      const dx = 54;
      const dy = groundY - (fh*scale) - 6;

      // Foreground overlap strip (keeps the character seated in the ground plane)
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, groundY-2, Math.floor(w*0.56), 10);

      ctx.drawImage(img, sx, sy, fw, fh, dx, dy, fw*scale, fh*scale);
    }
  }

  const menuScene = new MenuScene();
  menuScene.setReducedMotion(prefs.get(LS.reducedMotion,'0')==='1');

  function setReducedMotion(v){
    prefs.set(LS.reducedMotion, v ? '1':'0');
    menuScene.setReducedMotion(!!v);
  }

  // Showcase sprite resolver (no gameplay runtime required)
  let _reg = null;
  let _assetsById = null;
  async function ensureRegistry(){
    if (_reg) return;
    _reg = await loadJSON('runtime/registry.json');
    _assetsById = new Map((_reg.assets||[]).map(a => [a.id, a]));
  }
  function assetPath(id){
    const a = _assetsById?.get(id);
    return a?.path || null;
  }

  let showcaseCreatureId = null;
  async function syncShowcase(){
    try {
      await ensureRegistry();
      showcaseCreatureId = resolveShowcaseCreatureId();
      const c = showcaseCreatureId ? content.creature(showcaseCreatureId) : null;
      if (elMMShowcaseName) elMMShowcaseName.textContent = c?.displayName || showcaseCreatureId || '—';

      // Update menu scene sprite sheet
      const sid = showcaseCreatureId ? `player.${showcaseCreatureId}.sheet` : null;
      const p = sid ? assetPath(sid) : null;
      if (p) {
        const img = new Image();
        img.src = p;
        img.onload = () => menuScene.setShowcaseSheet(img);
        img.onerror = () => menuScene.setShowcaseSheet(null);
      } else {
        menuScene.setShowcaseSheet(null);
      }
    } catch (e) {
      menuScene.setShowcaseSheet(null);
    }
  }

  // --- Menu ---
  let menuSel = { creatureId: null, stageId: null, weaponFamilyId: null, weaponId: null, showExperimental: false };

  // Preferred showcase + default selection: favorite overrides last-used.
  function getFavoriteId(){
    const fav = prefs.get(LS.favoriteCharacterId, null);
    return (fav && typeof fav === 'string' && fav.trim().length) ? fav : null;
  }
  function getLastUsedId(){
    const last = prefs.get(LS.lastUsedCharacterId, null);
    return (last && typeof last === 'string' && last.trim().length) ? last : null;
  }

  function safeDefaultCreatureId(){
    const all = content.listCreatures(true);
    return all.length ? all[0].id : null;
  }

  function resolveShowcaseCreatureId(){
    const fav = getFavoriteId();
    const last = getLastUsedId();
    const all = content.listCreatures(true);
    const ok = (id) => !!id && all.some(c => c.id === id);
    if (ok(fav)) return fav;
    if (ok(last)) return last;
    return safeDefaultCreatureId();
  }

  // Bootstrap the loadout selection to last-used (or fallback)
  menuSel.creatureId = resolveShowcaseCreatureId();

  // Screen router
  let uiScreen = 'main';
  let pendingMode = 'solo_auto';
  let runMode = 'solo_auto';
  let player2 = null;
  let p2Aim = { x: 1, y: 0 }; // main | play | mastery | settings | ingame
  function showScreen(id){
    uiScreen = id;
    // Main overlay
    if (elMainMenu) elMainMenu.classList.toggle('hidden', id !== 'main');
    // Play setup overlay (existing)
    if (elStart) elStart.classList.toggle('hidden', id !== 'play');
    if (elMastery) elMastery.classList.toggle('hidden', id !== 'mastery');
    if (elSettings) elSettings.classList.toggle('hidden', id !== 'settings');
    if (elBazaar) elBazaar.classList.toggle('hidden', id !== 'bazaar');
	  // Footer/help text should not bleed through menus (especially on itch embeds).
	  if (elFooter) elFooter.classList.toggle('hidden', id !== 'ingame');
	  // Touch-safe pause button only visible during runs.
	  if (typeof elHudPauseBtn !== 'undefined' && elHudPauseBtn) {
	    elHudPauseBtn.classList.toggle('hidden', id !== 'ingame');
	  }
  }

  function goMain(){ showScreen('main'); }

  function ensureDefaultMenuSel(){
    // Ensure creature/stage/weapon are valid before starting directly from main menu.
    const launchCreatures = content.listCreatures(false) || [];
    const launchStages = content.listStages(false) || [];
    const launchWeapons = content.listWeaponFamilies(false) || [];

    if (!menuSel.creatureId || !content.creature(menuSel.creatureId)) {
      if (launchCreatures.length) menuSel.creatureId = launchCreatures[0].id;
    }
    if (!menuSel.stageId || !content.stage(menuSel.stageId)) {
      // Prefer Meadow Market if present.
      const mm = launchStages.find(s => s.id === 'meadow_market');
      menuSel.stageId = (mm ? mm.id : (launchStages[0]?.id || null));
    }

    // Character-defined signature weapon (Bible-driven via runtime/content.json weapons).
    const c = menuSel.creatureId ? content.creature(menuSel.creatureId) : null;
    const w = c ? (content.weaponForCreature(c.id) || null) : null;
    menuSel.weaponId = (c?.startingWeaponId || w?.weaponId || w?.id || menuSel.weaponId || null);

    // Keep weaponFamilyId for LaunchScope enforcement, but auto-derive it from the creature's base starting families
    // (weapon selection is character-tied in this build).
    const baseFam = (c && Array.isArray(c.startingWeapons) && c.startingWeapons.length) ? c.startingWeapons[0] : null;
    if (baseFam && content.weaponFamily(baseFam)) {
      menuSel.weaponFamilyId = baseFam;
    }
    if (!menuSel.weaponFamilyId || !content.weaponFamily(menuSel.weaponFamilyId)) {
      menuSel.weaponFamilyId = (launchWeapons[0]?.id || null);
    }
  }

  // PLAY opens the Run Setup flow (character -> stage -> starting weapon -> start run).
  function goPlaySetup(mode='solo_auto'){
    pendingMode = mode;
    ensureDefaultMenuSel();
    refreshStartScreen();
    showScreen('play');
  }

  // Back-compat alias used by older menu/router codepaths.
  // In this build, "Play" means entering the loadout setup screen.
  function goPlay(mode='solo_auto'){
    goPlaySetup(mode);
  }

  // Refresh the Play/Run-Setup screen.
  // (A prior refactor left the callsite but removed the function.)
  function refreshStartScreen(){
    // Update the panel title/button label to match the selected mode.
    try{
      const panelTitle = elStart ? elStart.querySelector('.panelTitle') : null;
      if (panelTitle) {
        const label = (pendingMode === 'coop_auto') ? 'CO-OP' : (pendingMode === 'pvp_aim' ? 'PVP' : 'Solo');
        panelTitle.textContent = `WILDLANDS : CRITTER CLASH — Play (${label})`;
      }
      if (elBtnStart) {
        elBtnStart.textContent = (pendingMode === 'coop_auto')
          ? 'PLAY — Start CO-OP'
          : (pendingMode === 'pvp_aim' ? 'PLAY — Start PVP' : 'PLAY — Start Game');
      }
    }catch{}
    // Main renderer for the run setup UI.
    try{ refreshMenu(); }catch{}
  }

  // QUICK PLAY preserves the original one-click start behavior.
  function goQuickPlay(mode='solo_auto'){
    pendingMode = mode;
    ensureDefaultMenuSel();
    showScreen('ingame');
    startRun();
  }
  async function goMastery(){ showScreen('mastery'); await ensureRuntime().catch(()=>{}); refreshMastery(); }
  function goSettings(){ showScreen('settings'); }
  function goBazaar(){ showScreen('bazaar'); refreshBazaar(); }

  function makeCard({ title, subtitle, iconAssetId, isExperimental=false, onClick }) {
    const el = document.createElement('div');
    el.className = 'card' + (isExperimental ? ' experimental' : '');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', title);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.alignItems = 'center';

    const img = document.createElement('img');
    img.width = 40; img.height = 40;
    img.style.imageRendering = 'pixelated';
    // Menu icons must work even when only the launch preload set is loaded.
    // Prefer the registry path directly; also opportunistically preload in the background.
    let iconAsset = (assets && iconAssetId) ? assets.get(iconAssetId) : null;
    // Fallbacks for common icon ID drift (keeps UI resilient to content edits).
    if (assets && !iconAsset && iconAssetId && typeof iconAssetId === 'string'){
      const base = iconAssetId.replace(/\.png$/,'');
      const tries = [base, base.replace(/\.icon$/,'.icon'), base.replace(/\.sprite$/,'.sprite')];
      for (const tid of tries){
        const a = assets.get(tid);
        if (a) { iconAsset = a; break; }
      }
    }
    if (iconAsset?.path) {
      img.src = iconAsset.path;
      // Fire-and-forget preload so in-game draws can use cached HTMLImageElement.
      if (assets) assets.preloadAssetIds([iconAssetId]).catch(()=>{});
    } else if (assets) {
      // Never render primitives as final art. If an icon is missing, use an explicit missing-asset sprite.
      const miss = assets.get('ui.missing_asset.icon');
      if (miss?.path) {
        img.src = miss.path;
        assets.preloadAssetIds(['ui.missing_asset.icon']).catch(()=>{});
      }
    }

    const text = document.createElement('div');
    const h = document.createElement('div');
    h.textContent = title;
    h.style.fontWeight = '700';
    const p = document.createElement('div');
    p.textContent = subtitle || '';
    p.style.opacity = '0.85';
    p.style.fontSize = '12px';

    text.appendChild(h);
    text.appendChild(p);
    row.appendChild(img);
    row.appendChild(text);
    el.appendChild(row);

    // Use pointer events for reliable selection on iOS; "click" can be swallowed by
    // focus/scroll or delayed in some contexts.
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }, { passive: false });
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    });
    return el;
  }

  function refreshMenu() {
    menuSel.showExperimental = !!elToggleExp.checked;

    // Ensure selections remain valid when toggling experimental content.
    // Also auto-select sane defaults so the UI is always playable.
    const creatures = content.listCreatures(menuSel.showExperimental);
    const stages = content.listStages(menuSel.showExperimental);
    const weaponFamilies = content.listWeaponFamilies(menuSel.showExperimental);

    if (menuSel.creatureId && !creatures.some(c => c.id === menuSel.creatureId)) menuSel.creatureId = null;
    if (menuSel.stageId && !stages.some(s => s.id === menuSel.stageId)) menuSel.stageId = null;

    if (!menuSel.creatureId && creatures.length) menuSel.creatureId = creatures[0].id;
    if (!menuSel.stageId && stages.length) menuSel.stageId = stages[0].id;

    // Character-tied signature weapon (Bible Weapons sheet).
    const selCreature = menuSel.creatureId ? content.creature(menuSel.creatureId) : null;
    const sigWeapon = selCreature ? (content.weaponForCreature(selCreature.id) || null) : null;
    menuSel.weaponId = (selCreature?.startingWeaponId || sigWeapon?.weaponId || sigWeapon?.id || null);

    // Keep weaponFamilyId for LaunchScope + projectile tuning; auto-derive from creature base start families.
    const baseFam = (selCreature && Array.isArray(selCreature.startingWeapons) && selCreature.startingWeapons.length)
      ? selCreature.startingWeapons[0]
      : null;
    if (baseFam && weaponFamilies.some(w => w.id === baseFam)) menuSel.weaponFamilyId = baseFam;
    if (!menuSel.weaponFamilyId && weaponFamilies.length) menuSel.weaponFamilyId = weaponFamilies[0].id;

    // creatures
    elCreatureList.innerHTML = '';
    for (const c of creatures) {
      const iconId = assets ? assets.creatureIconAssetId(c.id) : (`player.${c.id}.icon`);
      const card = makeCard({
        title: c.displayName,
        subtitle: (c.isExperimental ? 'Experimental' : 'Launch'),
        iconAssetId: iconId,
        isExperimental: !!c.isExperimental,
        onClick: () => {
          menuSel.creatureId = c.id;
          prefs.set(LS.lastUsedCharacterId, c.id);
          syncShowcase();
          refreshMenu();
        }
      });
      if (menuSel.creatureId === c.id) card.classList.add('selected');
      elCreatureList.appendChild(card);
    }

    // stages
    elStageList.innerHTML = '';
    for (const s of stages) {
      const card = makeCard({
        title: s.displayName || s.id,
        subtitle: (s.isExperimental ? 'Experimental' : 'Launch'),
        iconAssetId: 'core.grass', // deterministic fallback icon
        isExperimental: !!s.isExperimental,
        onClick: () => { menuSel.stageId = s.id; refreshMenu(); }
      });
      if (menuSel.stageId === s.id) card.classList.add('selected');
      elStageList.appendChild(card);
    }

    // weapon (single, character-tied)
    elWeaponList.innerHTML = '';
    const wTitle = (sigWeapon?.displayName || selCreature?.startingWeaponName || selCreature?.startingWeaponId || menuSel.weaponId || '—');
    // Prefer weapon icon variant if present in registry: weaponFamily.weapon_<base>.icon
    const candidates = [];
    if (baseFam) candidates.push(`weaponFamily.weapon_${String(baseFam).toLowerCase()}.icon`);
    if (baseFam) candidates.push(`weaponFamily.family_${String(baseFam).toLowerCase()}.icon`);
    candidates.push('core.projectile');
    let iconId = candidates[0];
    if (assets){
      for (const cid of candidates){
        if (assets.get(cid)) { iconId = cid; break; }
      }
    }
    const wCard = makeCard({
      title: wTitle,
      subtitle: selCreature ? `Starting weapon for ${selCreature.displayName}` : 'Starting weapon',
      iconAssetId: iconId,
      isExperimental: !!(sigWeapon && !sigWeapon.isLaunch),
      onClick: () => {} // not selectable in this build
    });
    wCard.classList.add('selected');
    elWeaponList.appendChild(wCard);

    const ready = !!(menuSel.creatureId && menuSel.stageId && menuSel.weaponId && menuSel.weaponFamilyId);
    elBtnStart.disabled = !ready;
  }

  elToggleExp.addEventListener('change', refreshMenu);
  elBtnStart.addEventListener('click', () => { startRun(); });

  // Initial screen: Main Menu (diorama). Play setup is entered via the menu.
  showScreen('main');
  refreshMenu();
  syncShowcase();
  // Load registry early so menu icons render correctly (non-blocking).
  ensureRuntime().then(() => {
    refreshMenu();
    refreshMastery();
    syncShowcase();
  }).catch((e) => diag.warn('RUNTIME_INIT_EARLY_FAILED', { error: String(e) }));

  // Main menu (data-driven)
  const MAIN_MENU_ITEMS = [
    // Primary flow: opens the Run Setup submenu.
    { id: 'play_setup', label: 'PLAY', action: () => goPlaySetup('solo_auto') },
    { id: 'coop_setup', label: 'CO-OP (LOCAL)', action: () => goPlaySetup('coop_auto') },
    { id: 'pvp_setup', label: 'PVP (LOCAL)', action: () => goPlaySetup('pvp_aim') },

    // Online (itch.io): fail-soft to offline if signaling is unreachable.
    { id: 'online_coop', label: 'Play CO-OP Online', action: () => netHost('coop') },
    { id: 'online_pvp', label: 'Play PvP Online', action: () => netHost('pvp') },
    { id: 'online_join', label: 'Join Lobby Code', action: () => {
      const code = prompt('Enter lobby code:');
      if (code) netJoin(code);
    } },
    { id: 'mastery', label: 'Mastery', action: () => goMastery() },
    { id: 'bazaar', label: 'Bazaar', action: () => goBazaar() },
    { id: 'settings', label: 'Settings', action: () => goSettings() },
    { id: 'exit', label: 'Exit', action: () => {
      // Browsers often block window.close unless the tab was opened via script.
      try { window.close(); } catch {}
      alert('Exit is not supported in this browser tab. Close the tab/window to exit.');
    } }
  ];

  // QUICK PLAY button (small, top-right): preserves one-click solo start.
  const elBtnQuickPlay = document.getElementById('btnQuickPlay');
  if (elBtnQuickPlay) {
    elBtnQuickPlay.addEventListener('click', () => goQuickPlay('solo_auto'));
  }

  let mmIndex = 0;
  let _mmLastActivateAt = 0;
  
function updateMainMenuSelection(){
    if (!elMMButtons) return;
    const btns = elMMButtons.querySelectorAll('button.mmBtn');
    for (let i=0;i<btns.length;i++){
      if (i === mmIndex) btns[i].classList.add('selected');
      else btns[i].classList.remove('selected');
    }
  }

  function renderMainMenuButtons(){
    if (!elMMButtons) return;

    // Build once; never re-render on hover/focus/tap (iOS destroys the target before click).
    if (elMMButtons.dataset.built === '1'){
      updateMainMenuSelection();
      return;
    }

    elMMButtons.innerHTML = '';
    MAIN_MENU_ITEMS.forEach((it, idx) => {
      const b = document.createElement('button');
      b.className = 'mmBtn';
      b.type = 'button';
      b.textContent = it.label;

      b.addEventListener('pointerenter', (e) => {
        const hoverNone = window.matchMedia && window.matchMedia('(hover: none)').matches;
        if (hoverNone || (e && e.pointerType === 'touch')) return;
        if (mmIndex !== idx){
          mmIndex = idx;
          updateMainMenuSelection();
          audio.play('assets/audio/hit.wav', { volume: 0.08 }).catch(()=>{});
        }
        menuScene.triggerFlourish();
      });

      b.addEventListener('focus', () => {
        if (mmIndex !== idx){
          mmIndex = idx;
          updateMainMenuSelection();
        }
      });

      const activate = () => {
        const now = performance.now();
        if (now - _mmLastActivateAt < 220) return;
        _mmLastActivateAt = now;
        audio.play('assets/audio/dash.wav', { volume: 0.14 }).catch(()=>{});
        try { it.action(); } catch (err) { console.error(err); }
      };

      b.addEventListener('click', (e) => { e.preventDefault(); activate(); });
      b.addEventListener('touchend', (e) => { e.preventDefault(); activate(); }, { passive:false });
      b.addEventListener('pointerup', (e) => {
        if (e && e.button !== undefined && e.button !== 0) return;
        // On iOS, click may not fire consistently; pointerup is a fallback.
        activate();
      });

      elMMButtons.appendChild(b);
    });

    elMMButtons.dataset.built = '1';
    updateMainMenuSelection();
  }
  renderMainMenuButtons();

  // Main menu keyboard / gamepad-ish navigation
  window.addEventListener('keydown', (e) => {
    if (uiScreen !== 'main') return;
    if (e.key === 'ArrowDown' || e.key === 's') {
      mmIndex = (mmIndex + 1) % MAIN_MENU_ITEMS.length;
      renderMainMenuButtons();
      audio.play('assets/audio/hit.wav', { volume: 0.07 }).catch(()=>{});
      e.preventDefault();
    }
    if (e.key === 'ArrowUp' || e.key === 'w') {
      mmIndex = (mmIndex + MAIN_MENU_ITEMS.length - 1) % MAIN_MENU_ITEMS.length;
      renderMainMenuButtons();
      audio.play('assets/audio/hit.wav', { volume: 0.07 }).catch(()=>{});
      e.preventDefault();
    }
    if (e.key === 'Enter' || e.key === ' ') {
      MAIN_MENU_ITEMS[mmIndex]?.action?.();
      audio.play('assets/audio/dash.wav', { volume: 0.14 }).catch(()=>{});
      e.preventDefault();
    }
  });

  // Settings wiring
  audio.init().catch(()=>{});
  if (elToggleReducedMotion) {
    elToggleReducedMotion.checked = prefs.get(LS.reducedMotion,'0') === '1';
    elToggleReducedMotion.addEventListener('change', () => setReducedMotion(!!elToggleReducedMotion.checked));
  }
  // Chrome / accessibility toggles
  function applyChromeFromPrefs(){
    const qpMinimal = urlParams.get('minimal') === '1';
    const prefMinimal = prefs.get(LS.minimalChrome, '0') === '1';
    const on = qpMinimal || prefMinimal;
    document.body.classList.toggle('minimalChrome', on);
    if (elToggleMinimalChrome) elToggleMinimalChrome.checked = on;
  }
  applyChromeFromPrefs();

  if (elToggleMinimalChrome) {
    elToggleMinimalChrome.addEventListener('change', () => {
      prefs.set(LS.minimalChrome, elToggleMinimalChrome.checked ? '1':'0');
      applyChromeFromPrefs();
      applyIntegerScale();
    });
  }
  if (elToggleLowVfx) {
    elToggleLowVfx.checked = prefs.get(LS.lowVfx, '0') === '1';
    elToggleLowVfx.addEventListener('change', () => prefs.set(LS.lowVfx, elToggleLowVfx.checked ? '1':'0'));
  }
  if (elToggleScreenshake) {
    // Default ON
    elToggleScreenshake.checked = prefs.get(LS.screenshake, '1') === '1';
    elToggleScreenshake.addEventListener('change', () => prefs.set(LS.screenshake, elToggleScreenshake.checked ? '1':'0'));
  }
  if (elToggleReducedFlashes) {
    // Default ON for accessibility
    elToggleReducedFlashes.checked = prefs.get(LS.reducedFlashes, '1') === '1';
    elToggleReducedFlashes.addEventListener('change', () => prefs.set(LS.reducedFlashes, elToggleReducedFlashes.checked ? '1':'0'));
  }
  if (elToggleAllowFit) {
    elToggleAllowFit.checked = prefs.get(LS.allowFitBelow1, '0') === '1';
    elToggleAllowFit.addEventListener('change', () => { prefs.set(LS.allowFitBelow1, elToggleAllowFit.checked ? '1':'0'); applyIntegerScale(); });
  }
  if (elToggleMute) {
    elToggleMute.addEventListener('change', () => audio.setMuted(!!elToggleMute.checked));
  }
  if (elBtnBackFromSettings) elBtnBackFromSettings.addEventListener('click', () => goMain());

  // Fullscreen button (works in iframe when allowed; fail-soft with toast)
  async function requestFullscreen(){
    const target = document.getElementById('wrap') || document.documentElement;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await (target.requestFullscreen ? target.requestFullscreen({ navigationUI: 'hide' }) : target.webkitRequestFullscreen?.());
    } catch (e) {
      toast('Fullscreen was blocked by the embed/browser settings.');
    }
  }
  if (elBtnFullscreen) elBtnFullscreen.addEventListener('click', () => requestFullscreen());

  // Mastery (Favorite character)
  let masterySel = { creatureId: resolveShowcaseCreatureId() };
  function refreshMastery(){
  if (!elMasteryCreatureList) return;
  const all = content.listCreatures(true);
  const fav = getFavoriteId();
  const label = fav ? `Favorite: ${content.creature(fav)?.displayName || fav}` : 'Favorite: (none)';
  if (elFavState) elFavState.textContent = label;
  if (fav) masterySel.creatureId = fav;
  else if (!masterySel.creatureId) masterySel.creatureId = resolveShowcaseCreatureId();

  elMasteryCreatureList.innerHTML = '';
  for (const c of all){
    const iconId = assets ? assets.creatureIconAssetId(c.id) : (`player.${c.id}.icon`);
    const card = makeCard({
      title: c.displayName,
      subtitle: (c.isExperimental ? 'Experimental' : 'Launch'),
      iconAssetId: iconId,
      isExperimental: !!c.isExperimental,
      onClick: () => { masterySel.creatureId = c.id; refreshMastery(); }
    });
    if (masterySel.creatureId === c.id) card.classList.add('selected');
    elMasteryCreatureList.appendChild(card);
  }

  // --- Detail panel ---
  const cid = masterySel.creatureId;
  const c = cid ? content.creature(cid) : null;
  if (elMasteryName) elMasteryName.textContent = c?.displayName || '—';
  if (elMasteryRole) {
    const roles = (c?.roleTags && c.roleTags.length) ? c.roleTags.join(' • ') : '';
    const gimmick = c?.gimmick ? ` — ${c.gimmick}` : '';
    elMasteryRole.textContent = (roles || c?.id || '—') + gimmick;
  }
  // Icon
  if (elMasteryIcon) {
    let iconAsset = (assets && cid) ? assets.get(assets.creatureIconAssetId(cid)) : null;
    if (!iconAsset && assets && cid) iconAsset = assets.get(`player.${cid}.icon`);
    elMasteryIcon.src = iconAsset?.path || '';
    elMasteryIcon.style.display = elMasteryIcon.src ? 'block' : 'none';
  }

  // Starting weapon (Bible-driven)
  if (elMasteryWeapon) {
    const wName = c?.startingWeaponName || '';
    const wId = c?.startingWeaponId || '';
    elMasteryWeapon.textContent = (wName && wId) ? `${wName} (${wId})` : (wName || wId || '—');
  }

  // Stats (per-creature)
  if (elMasteryStats) {
    let cs = null;
    try {
      const prof = profileStore.load();
      cs = prof?.creatures?.[cid] || null;
    } catch (_) {}
    const fmt = (n) => {
      if (n == null) return 0;
      const x = Number(n);
      if (!Number.isFinite(x)) return 0;
      return Math.round(x);
    };
    const fmtTime = (sec) => {
      sec = Math.max(0, Number(sec||0));
      const m = Math.floor(sec/60);
      const s = Math.floor(sec%60);
      return `${m}m ${String(s).padStart(2,'0')}s`;
    };
    if (!cs) {
      elMasteryStats.textContent = 'No runs yet on this creature.';
    } else {
      elMasteryStats.innerHTML = `
        <div>Runs: <b>${fmt(cs.runs)}</b> · Deaths: <b>${fmt(cs.deaths)}</b></div>
        <div>Playtime: <b>${fmtTime(cs.playtimeSec)}</b> · Longest: <b>${fmtTime(cs.longestSurvivalSec)}</b></div>
        <div>Kills: <b>${fmt(cs.kills)}</b> · Damage Dealt: <b>${fmt(cs.damageDealt)}</b></div>
        <div>Damage Taken: <b>${fmt(cs.damageTaken)}</b> · Highest Level: <b>${fmt(cs.highestLevel)}</b></div>
      `;
    }
  }

  // Evolution line (creature-scoped, Bible-driven)
  if (elMasteryEvolution) {
    const nodes = cid ? (content.evolutionNodesForCreature?.(cid) || []) : [];
    if (!nodes.length) {
      elMasteryEvolution.textContent = 'No evolution data found.';
    } else {
      const byBranch = new Map();
      for (const n of nodes) {
        const b = String(n.branch || 'MAIN').toUpperCase();
        if (!byBranch.has(b)) byBranch.set(b, []);
        byBranch.get(b).push(n);
      }
      const branches = Array.from(byBranch.keys()).sort();
      const html = branches.map(b => {
        const list = byBranch.get(b).slice().sort((a,b)=> (a.tier-b.tier) || (a.uiSort-b.uiSort) || a.name.localeCompare(b.name));
        const items = list.map(n => `<div class="evoNodeLine"><span class="badge">${'T'+(n.tier||1)}</span> <b>${escapeHtml(n.name||n.id)}</b> <span style="opacity:0.75">(${escapeHtml(n.id)})</span></div>`).join('');
        return `<div class="evoBranch"><div class="blockTitle">${escapeHtml(b)}</div>${items}</div>`;
      }).join('');
      elMasteryEvolution.innerHTML = html;
    }
  }
}

function refreshBazaar(){
    if (!elBazaarAttachmentList) return;
    // Build a simple gallery from real attachment assets present in the build.
    const all = (content?.registry?.assets || []).filter(a => (a.path||'').includes('assets/attachments/') && (a.path||'').endsWith('.png'));
    elBazaarAttachmentList.innerHTML = '';
    const list = all.length ? all : [];
    if (elBazaarHint) elBazaarHint.textContent = list.length ? 'Click an attachment to preview it in the diorama.' : 'No attachments found in registry.';
    list.slice(0, 200).forEach(a => {
      const card = document.createElement('div');
      card.className = 'card';
      const title = document.createElement('div');
      title.className = 'cardTitle';
      title.textContent = (a.id || '').replace(/^att_/, '').replace(/_/g,' ');
      const sub = document.createElement('div');
      sub.className = 'cardSub';
      sub.textContent = a.path;
      const img = document.createElement('img');
      img.className = 'icon';
      img.src = a.path;
      img.alt = a.id || a.path;
      const row = document.createElement('div');
      row.className = 'row iconRow';
      row.appendChild(img);
      card.appendChild(title);
      card.appendChild(sub);
      card.appendChild(row);
      card.addEventListener('click', () => {
        // Preview by triggering a tiny flourish; this keeps Bazaar "real" without inventing a shop.
        menuScene.triggerFlourish();
        audio.play('assets/audio/hit.wav', { volume: 0.08 }).catch(()=>{});
      });
      elBazaarAttachmentList.appendChild(card);
    });
  }

if (elBtnSetFavorite) elBtnSetFavorite.addEventListener('click', () => {
    const id = masterySel.creatureId || resolveShowcaseCreatureId();
    if (id) prefs.set(LS.favoriteCharacterId, id);
    syncShowcase();
    refreshMastery();
    audio.play('assets/audio/crit.wav', { volume: 0.10 }).catch(()=>{});
  });
  if (elBtnClearFavorite) elBtnClearFavorite.addEventListener('click', () => {
    prefs.set(LS.favoriteCharacterId, null);
    syncShowcase();
    refreshMastery();
    audio.play('assets/audio/hit.wav', { volume: 0.08 }).catch(()=>{});
  });
  if (elBtnBackFromMastery) elBtnBackFromMastery.addEventListener('click', () => goMain());

  // Esc back (Mastery/Settings/Play -> Main)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (gamePaused) return;
    if (uiScreen === 'mastery' || uiScreen === 'settings' || uiScreen === 'play') {
      goMain();
      e.preventDefault();
    }
  });

  // --- Game state (deterministic) ---
  // World size is stage-driven; default is a safe dev fallback.
  const world = { w: 2600, h: 2600 };
  const cam = { x: 0, y: 0 };

  // Stage tiles (Meadow Market variance: grass/dirt/water)
  let stageTiles = null; // { tile:64, cols, rows, data:Uint8Array, waterCount }
  let stageWater = null; // { rects:[{x,y,w,h}] } for quick collision/avoidance

  // Boss arena border (hard ring)
  const BOSS_TRIGGER_SECONDS = 900; // 15:00
  const BOSS_BORDER_RADIUS_PX = 520;
  const BOSS_SPAWN_DELAY_MS = 1500;
  const BOSS_SPAWN_MIN_DISTANCE_PX = 220;
  let bossArena = null; // { active, cx, cy, r, t0Ms }


  // Debug boss entity (prototype parity)
  let boss = null; // {x,y,hp,r,speed,sheetId,t,scale}

  // --- Gameplay wiring (Bible-driven where available) ---
  // Run timer drives the 15:00 boss countdown (900s). Boss spawns when countdown reaches 0.
  let runTimeSec = 0;
  const BOSS_COUNTDOWN_SEC = BOSS_TRIGGER_SECONDS;
  let bossSpawned = false;

  // Hitstop / screenshake for combat weight
  let hitStopTimer = 0;
  let shakeTimer = 0;
  let shakeMag = 0;

  // Stage props/blockers
  let stageProps = []; // {x,y,r,assetId,w,h}

  // Floating numbers and simple hit rings
  let floaters = []; // {x,y,vy,life,text,color}
  let hitRings = []; // {x,y,life,r0,color,fill}
  let telegraphs = []; // {x1,y1,x2,y2,life,color}
  let puddles = []; // {x,y,r,life,kind}
  // Player weapon zones (signature weapons): damage enemies/boss over time
  let weaponZones = []; // {x,y,r,life,life0,kind, tickEvery, tickT, dmg, dmgType, slowMul}
  let bossLeaves = []; // {x,y,vx,vy,life,life0,rot,vr,scale}
  let bossZoomMul = 1.0; // intro zoom punch

  function spawnFloater(x,y,text,isPlayer){
    floaters.push({ x, y, vy: -22, life: 0.7, text: String(text), color: isPlayer ? '#ffb3b3' : '#ffd68a' });
  }
  function spawnHitRing(x,y, { life=0.25, r0=6, color='#ffd68a', fill=false } = {}){
    // Reduced flashes: shorter + dimmer rings
    const rf = prefs.get(LS.reducedFlashes,'1') === '1';
    hitRings.push({ x, y, life: rf ? Math.min(life, 0.18) : life, r0, color: rf ? 'rgba(255,214,138,0.65)' : color, fill });
  }
  function addTelegraphLine(x1,y1,x2,y2, { life=0.22, color='rgba(255,214,138,0.9)' } = {}){
    const rf = prefs.get(LS.reducedFlashes,'1') === '1';
    telegraphs.push({ x1,y1,x2,y2, life: rf ? Math.min(life, 0.16) : life, color: rf ? 'rgba(255,214,138,0.55)' : color });
  }
  function addShake(mag, dur){
    if (prefs.get(LS.screenshake,'1') !== '1') return;
    shakeMag = Math.max(shakeMag, mag);
    shakeTimer = Math.max(shakeTimer, dur);
  }

  function addShakeForDamage(dmg, { bossImpact=false } = {}){
    const a = Math.max(0, dmg||0);
    // tiers tuned for VS-like readability (small hits don't jitter the camera)
    let mag = 0, dur = 0;
    if (a >= 120) { mag = 14; dur = 0.22; }
    else if (a >= 70) { mag = 11; dur = 0.18; }
    else if (a >= 35) { mag = 8; dur = 0.14; }
    else if (a >= 15) { mag = 5; dur = 0.10; }
    else if (a >= 6) { mag = 3; dur = 0.08; }
    else { mag = 2; dur = 0.06; }
    if (bossImpact) { mag += 2; dur += 0.03; }
    addShake(mag, dur);
  }


  // Weapon VFX + melee hit helpers (character base weapons)
  const _WL_TILE = 32;
  function _segDist2_local(ax, ay, bx, by, px, py){
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const ab2 = abx*abx + aby*aby;
    let t = ab2 > 1e-9 ? (apx*abx + apy*aby) / ab2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = ax + abx*t, cy = ay + aby*t;
    const dx = px - cx, dy = py - cy;
    return dx*dx + dy*dy;
  }

  function spawnWeaponVfx(type, x, y, dx, dy, opts = {}){
    const { life=0.18, kind='default', power=1 } = (opts||{});
    weaponVfx.push({ type, x, y, dx, dy, life, life0: life, kind, power });
  }

  function _shapeHitsTarget(shape, ox, oy, ax, ay, tx, ty, tr){
    // shape in local-space forward (+X) rotated by (ax,ay).
    // ox/oy = origin, ax/ay = forward unit.
    const dx = tx - ox, dy = ty - oy;
    const along = dx*ax + dy*ay;
    const perp = -dx*ay + dy*ax;
    const type = String(shape?.type||'').toLowerCase();
    if (type === 'circle'){
      const r = Number(shape.radius||0) + (tr||0);
      return (dx*dx + dy*dy) <= r*r;
    }
    if (type === 'rect'){
      const len = Number(shape.length||0);
      const w = Number(shape.width||0);
      const off = Number(shape.offsetForward||0);
      const cx = off;
      return (Math.abs(perp) <= (w*0.5 + (tr||0))) && (Math.abs(along - cx) <= (len*0.5 + (tr||0)));
    }
    if (type === 'cone'){
      const r = Number(shape.radius||0) + (tr||0);
      const off = Number(shape.offsetForward||0);
      const ang = Number(shape.angleDeg||90) * Math.PI/180;
      const cx = ox + ax*off;
      const cy = oy + ay*off;
      const vx = tx - cx, vy = ty - cy;
      const d = Math.hypot(vx,vy) || 1;
      if (d > r) return false;
      const nx = vx/d, ny = vy/d;
      const dot = nx*ax + ny*ay;
      const arcCos = Math.cos(ang*0.5);
      // Optional reverse cone (for rear attacks)
      if (shape.reverse) return dot <= -arcCos;
      return dot >= arcCos;
    }
    if (type === 'arc'){
      const rad = Number(shape.radius||0);
      const thick = Number(shape.thickness||0);
      const off = Number(shape.offsetForward||0);
      const ang = Number(shape.angleDeg||90) * Math.PI/180;
      const cx = ox + ax*off;
      const cy = oy + ay*off;
      const vx = tx - cx, vy = ty - cy;
      const d = Math.hypot(vx,vy) || 1;
      const minR = Math.max(0, rad - thick*0.5);
      const maxR = rad + thick*0.5 + (tr||0);
      if (d < minR || d > maxR) return false;
      const nx = vx/d, ny = vy/d;
      const dot = nx*ax + ny*ay;
      const arcCos = Math.cos(ang*0.5);
      return dot >= arcCos;
    }
    if (type === 'ring'){
      const inR = Number(shape.innerRadius||0);
      const outR = Number(shape.outerRadius||0) + (tr||0);
      const d = Math.hypot(dx,dy);
      return d >= inR && d <= outR;
    }
    return false;
  }

  function _gatherTargetsForShape(p, shape, ax, ay){
    const hits = [];
    for (const e of enemies){
      if (_shapeHitsTarget(shape, p.x, p.y, ax, ay, e.x, e.y, (e.r||22))) hits.push(e);
    }
    if (boss && _shapeHitsTarget(shape, p.x, p.y, ax, ay, boss.x, boss.y, (boss.r||64))) hits.push(boss);
    return hits;
  }

  function applySignatureWeaponAttack(p, weaponDef, dx, dy, dmg){
    // Deterministic immediate-damage prototype.
    // Frame timing is enforced by fireCadence (set from attackProfile total frames).
    const prof = weaponDef?.attackProfile || null;
    if (!prof) return false;
    const aimLen = Math.hypot(dx,dy) || 1;
    const ax = dx/aimLen, ay = dy/aimLen;

    let hitAny = false;

    const applyHitList = (hitList, dmgScale=1.0) => {
      if (!Array.isArray(hitList)) return;
      const uniq = new Set();
      for (const h of hitList){
        const shape = h?.shape;
        if (!shape) continue;
        const targets = _gatherTargetsForShape(p, shape, ax, ay);
        for (const target of targets){
          if (!target || uniq.has(target)) continue;
          uniq.add(target);
          const mult = Number(h?.damage?.mult ?? 1);
          const dealt = Math.max(1, Math.round(dmg * dmgScale * mult));
          if (target.hp != null) target.hp -= dealt;
          hitAny = true;
          spawnFloater(target.x, target.y-18, dealt|0, false);
          spawnHitRing(target.x, target.y);
          hitStopTimer = Math.max(hitStopTimer, (target===boss)?0.06:0.04);
          addShake((target===boss)?7:3, (target===boss)?0.13:0.08);
          try { profEnsure(player?.creatureId); if (_profCreature) { _profCreature.damageDealt = (_profCreature.damageDealt||0) + (dealt|0); profMark(); } } catch (_) {}

          const onHit = h?.onHit;
          if (onHit && onHit.status === 'poison_tether'){
            const dur = Number(onHit.durationFrames||48)/60;
            target._tether = { t: dur, tick: 0, every: Number(onHit.tickEveryFrames||12)/60, mult: Number(onHit.mult||0.25), src: p, range: Number(onHit.range||150) };
          }
        }
      }
    };

    const spawnZones = (zoneList) => {
      if (!Array.isArray(zoneList)) return;
      for (const z of zoneList){
        const shape = z?.shape;
        if (!shape) continue;
        const count = Math.max(1, Math.min(6, Number(z.count||1)));
        for (let i=0;i<count;i++){
          let zx = p.x, zy = p.y;
          const offF = Number(shape.offsetForward||z.offsetForward||0);
          zx += ax*offF; zy += ay*offF;
          const jx = (i===0?0:((frand()-0.5)*28));
          const jy = (i===0?0:((frand()-0.5)*28));
          zx += jx; zy += jy;
          const r = Number(shape.radius||shape.outerRadius||60);
          const life = Number(z.lingerFrames||60)/60;
          const tickEvery = Math.max(0.08, Number(z.tickEveryFrames||12)/60);
          const mult = Number(z.damage?.mult ?? 0.2);
          weaponZones.push({
            x: zx, y: zy,
            r,
            life, life0: life,
            kind: String(z.kind||'zone'),
            tickEvery,
            tickT: 0,
            dmg: Math.max(1, Math.round(dmg * mult)),
            dmgType: String(z.damage?.type || weaponDef.damageType || 'default'),
            slowMul: (z.slowMul != null) ? Number(z.slowMul) : null,
          });
        }
      }
    };

    const doProfile = (profObj) => {
      const motion = profObj?.motion;
      if (motion && motion.type === 'lunge'){
        const dist = Number(motion.distance||0);
        p.x = clamp(p.x + ax*dist, 30, world.w-30);
        p.y = clamp(p.y + ay*dist, 30, world.h-30);
        resolveCircleVsProps(p, p.r||18);
      }
      if (motion && motion.type === 'blink'){
        const dist = Number(motion.distance||0);
        p.x = clamp(p.x + ax*dist, 30, world.w-30);
        p.y = clamp(p.y + ay*dist, 30, world.h-30);
      }

      applyHitList(profObj.hits, 1.0);
      applyHitList(profObj.impact, 1.0);
      spawnZones(profObj.zones);

      if (Array.isArray(profObj.after)){
        for (const a of profObj.after){
          applyHitList(a?.hits, 1.0);
          spawnZones(a?.zones);
        }
      }
    };

    if (Array.isArray(prof.combo) && prof.combo.length){
      for (const step of prof.combo){
        doProfile(step);
      }
    } else {
      doProfile(prof);
    }

    // Visual: generic signature marker (placeholder) keyed by weaponId
    const _lvl = (typeof state !== 'undefined' && state && state.level) ? (state.level|0) : 1;
    const _muts = (typeof state !== 'undefined' && state && Array.isArray(state.activeMutations)) ? state.activeMutations.length : 0;
    const _pow = 1 + Math.min(3, Math.max(0, (_lvl-1))/3) + Math.min(2, _muts/4);
    spawnWeaponVfx(String(weaponDef.weaponId||weaponDef.id||'SIG').toUpperCase(), p.x, p.y, ax, ay, { life: Math.max(0.16, (Number(prof.activeFrames||6)/60) + 0.10), kind: String(weaponDef.damageType||'default'), power: _pow });
    return hitAny;
  }

  function applyMeleeAttack(p, wfRaw, atk, dx, dy, dmg){
    const type = String(atk?.type || '').toUpperCase();
    const kind = (wfRaw?.projectile?.kind) || (p.weaponFamilyId ? String(p.weaponFamilyId).toLowerCase() : 'default');

    let hitAny = false;
    const hits = [];

    const aimLen = Math.hypot(dx,dy) || 1;
    const ax = dx/aimLen, ay = dy/aimLen;

    if (type === 'STOMP_AURA'){
      const r = Number(atk.radius || 3.2) * _WL_TILE;
      for (const e of enemies){
        const ex = e.x - p.x, ey = e.y - p.y;
        const rr = (e.r||22) + r;
        if (ex*ex + ey*ey <= rr*rr){ hits.push(e); }
      }
      if (boss){
        const bx = boss.x - p.x, by = boss.y - p.y;
        const rr = (boss.r||64) + r;
        if (bx*bx + by*by <= rr*rr){ hits.push(boss); }
      }
      spawnWeaponVfx('STOMP_AURA', p.x, p.y, ax, ay, { life: Number(atk.duration||0.22), kind });
    }

    else if (type === 'CLAMP'){
      const range = Number(atk.range || 3.0) * _WL_TILE;
      const w = Number(atk.width || 2.2) * _WL_TILE;
      const h = Number(atk.height || 1.6) * _WL_TILE;
      const cx = p.x + ax*range;
      const cy = p.y + ay*range;
      for (const e of enemies){
        const rx = e.x - cx, ry = e.y - cy;
        const along = rx*ax + ry*ay;
        const perp = -rx*ay + ry*ax;
        if (Math.abs(perp) <= (w*0.5 + (e.r||22)) && Math.abs(along) <= (h*0.5 + (e.r||22))){ hits.push(e); }
      }
      if (boss){
        const rx = boss.x - cx, ry = boss.y - cy;
        const along = rx*ax + ry*ay;
        const perp = -rx*ay + ry*ax;
        if (Math.abs(perp) <= (w*0.5 + (boss.r||64)) && Math.abs(along) <= (h*0.5 + (boss.r||64))){ hits.push(boss); }
      }
      spawnWeaponVfx('CLAMP', cx, cy, ax, ay, { life: Number(atk.duration||0.16), kind });
    }

    else if (type === 'BEAR_CLAW'){
      const r = Number(atk.radius || 3.0) * _WL_TILE;
      const arc = Number(atk.arc || 100);
      const arcCos = Math.cos((arc*Math.PI/180) * 0.5);
      const cx = p.x + ax*(_WL_TILE*1.4);
      const cy = p.y + ay*(_WL_TILE*1.4);
      for (const e of enemies){
        const vx = e.x - cx, vy = e.y - cy;
        const d = Math.hypot(vx,vy) || 1;
        if (d <= r + (e.r||22)){
          const nx = vx/d, ny = vy/d;
          const dot = nx*ax + ny*ay;
          if (dot >= arcCos) hits.push(e);
        }
      }
      if (boss){
        const vx = boss.x - cx, vy = boss.y - cy;
        const d = Math.hypot(vx,vy) || 1;
        if (d <= r + (boss.r||64)){
          const nx = vx/d, ny = vy/d;
          const dot = nx*ax + ny*ay;
          if (dot >= arcCos) hits.push(boss);
        }
      }
      spawnWeaponVfx('BEAR_CLAW', cx, cy, ax, ay, { life: Number(atk.duration||0.18), kind });
    }

    else if (type === 'THORN_WHIP'){
      const range = Number(atk.range || 4.6) * _WL_TILE;
      const w = Number(atk.width || 1.4) * _WL_TILE;
      const x2 = p.x + ax*range;
      const y2 = p.y + ay*range;
      const w2 = (w*0.5);
      for (const e of enemies){
        const d2 = _segDist2_local(p.x, p.y, x2, y2, e.x, e.y);
        const rr = (e.r||22) + w2;
        if (d2 <= rr*rr) hits.push(e);
      }
      if (boss){
        const d2 = _segDist2_local(p.x, p.y, x2, y2, boss.x, boss.y);
        const rr = (boss.r||64) + w2;
        if (d2 <= rr*rr) hits.push(boss);
      }
      spawnWeaponVfx('THORN_WHIP', p.x, p.y, ax, ay, { life: Number(atk.duration||0.20), kind });
    }

    // Apply damage once per target (no multi-hit flicker).
    const uniq = new Set();
    for (const target of hits){
      if (!target || uniq.has(target)) continue;
      uniq.add(target);
      if (target.hp != null) target.hp -= dmg;
      hitAny = true;
      spawnFloater(target.x, target.y-18, dmg|0, false);
      spawnHitRing(target.x, target.y);
      hitStopTimer = Math.max(hitStopTimer, (target===boss)?0.06:0.04);
      addShake((target===boss)?7:3, (target===boss)?0.13:0.08);
      try { profEnsure(player?.creatureId); if (_profCreature) { _profCreature.damageDealt = (_profCreature.damageDealt||0) + (dmg|0); profMark(); } } catch (_) {}
    }

    if (hitAny){
      try {
        const hitId = wfRaw?.sfx?.hit;
        if (hitId) audio.play(`assets/audio/${hitId}.wav`, { volume: 0.08 }).catch(()=>{});
      } catch(_){ }
    }
  }

  function stageIsMeadow(){
    const id = (menuSel && menuSel.stageId) ? String(menuSel.stageId) : '';
    return id === 'meadow_market' || id === 'meadow' || id.includes('meadow');
  }

  // Scale Stage 1 to ~3x area (≈1.73x width/height) and generate meadow variance tiles.
  function applyStageWorldSizing(){
    const stage = (menuSel && menuSel.stageId) ? content.stage(menuSel.stageId) : null;
    // Default baseline: keep existing sizes for non-meadow stages.
    let w = 2600, h = 2600;
    if (stageIsMeadow()){
      // Previous baseline felt cramped; widen+heighten for ~3x area.
      w = 4600;
      h = 3600;
    } else if (stage && stage.worldW && stage.worldH) {
      w = Math.max(1200, stage.worldW|0);
      h = Math.max(900, stage.worldH|0);
    }
    world.w = w;
    world.h = h;
  }

  function ensureStageGroundTiles(){
    if (!stageIsMeadow()){
      stageTiles = null;
      stageWater = null;
      return;
    }
    const tile = 64;
    const cols = Math.ceil(world.w / tile);
    const rows = Math.ceil(world.h / tile);
    const data = new Uint8Array(cols * rows); // 0=grass,1=dirt,2=water

    // Seeded rng (uses existing frand()).
    // Base: grass everywhere.
    // Add dirt plazas/patches (15-25%).
    const targetDirt = Math.floor(cols * rows * (0.18 + frand()*0.08));
    let dirtPlaced = 0;

    function idx(x,y){ return y*cols + x; }
    function inb(x,y){ return x>=0 && y>=0 && x<cols && y<rows; }

    // Paint a blobby patch at a tile coord.
    function paintBlob(cx, cy, rMin, rMax, val){
      const r = Math.floor(rMin + frand()*(rMax-rMin+1));
      for (let y=cy-r; y<=cy+r; y++){
        for (let x=cx-r; x<=cx+r; x++){
          if (!inb(x,y)) continue;
          const dx = x-cx, dy = y-cy;
          const d2 = dx*dx + dy*dy;
          // irregular edge
          const jitter = (frand()-0.5)*0.9;
          const rr = r + jitter;
          if (d2 <= rr*rr){
            const i = idx(x,y);
            if (data[i] !== 2){ // never overwrite water
              if (data[i] !== val){
                data[i] = val;
                if (val===1) dirtPlaced++;
              }
            }
          }
        }
      }
    }

    // Dirt patches: a few large + several small.
    const blobs = 6 + (frand()*4|0);
    for (let i=0;i<blobs;i++){
      const cx = (cols*0.20 + frand()*cols*0.60)|0;
      const cy = (rows*0.20 + frand()*rows*0.60)|0;
      paintBlob(cx, cy, 3, 7, 1);
    }
    // Fill toward target dirt with micro blobs.
    let guard = 0;
    while (dirtPlaced < targetDirt && guard++ < 800){
      const cx = (frand()*cols)|0;
      const cy = (frand()*rows)|0;
      paintBlob(cx, cy, 2, 4, 1);
    }

    // Water: creek strip with light meander (5–12% and visible).
    // We paint a horizontal creek band across the map at ~45-60% height.
    const creekY = Math.floor(rows * (0.45 + frand()*0.15));
    const creekW = 1 + (frand()*2|0); // half-width in tiles
    let waterCount = 0;
    const meanderAmp = 2 + (frand()*3|0);
    for (let x=0; x<cols; x++){
      const t = x / Math.max(1, cols-1);
      const off = Math.floor(Math.sin(t * Math.PI * 2 * (1.2 + frand()*0.6)) * meanderAmp);
      const cy = creekY + off;
      for (let dy=-creekW; dy<=creekW; dy++){
        const y = cy + dy;
        if (!inb(x,y)) continue;
        const i = idx(x,y);
        // Soften edges: only overwrite dirt/grass.
        if (data[i] !== 2){
          data[i] = 2;
          waterCount++;
        }
      }
    }

    // Ensure water isn't too low; if it is, add a couple ponds.
    const minWater = Math.floor(cols*rows*0.06);
    guard = 0;
    while (waterCount < minWater && guard++ < 80){
      const cx = (cols*0.15 + frand()*cols*0.70)|0;
      const cy = (rows*0.15 + frand()*rows*0.70)|0;
      // pond blob
      const before = waterCount;
      const rMin = 2, rMax = 5;
      const r = Math.floor(rMin + frand()*(rMax-rMin+1));
      for (let y=cy-r; y<=cy+r; y++){
        for (let x=cx-r; x<=cx+r; x++){
          if (!inb(x,y)) continue;
          const dx = x-cx, dy = y-cy;
          if (dx*dx + dy*dy <= r*r){
            const i = idx(x,y);
            if (data[i] !== 2){
              data[i] = 2;
              waterCount++;
            }
          }
        }
      }
      if (waterCount === before) break;
    }

    stageTiles = { tile, cols, rows, data, waterCount };
    stageWater = { rects: [] };
  }

  function tileAtWorld(x, y){
    if (!stageTiles) return 0;
    const tx = Math.max(0, Math.min(stageTiles.cols-1, Math.floor(x / stageTiles.tile)));
    const ty = Math.max(0, Math.min(stageTiles.rows-1, Math.floor(y / stageTiles.tile)));
    return stageTiles.data[ty*stageTiles.cols + tx] || 0;
  }
  function isWaterWorld(x, y){
    return stageTiles ? (tileAtWorld(x,y) === 2) : false;
  }


  function initStageProps(){
    stageProps = [];
    // Use launch-tagged prop images from registry when available
    const reg = assets._registry;
    const ids = [];
    for (const a of (reg.assets || [])){
      if (a.type === 'image' && (a.tags||[]).includes('prop') && (a.tags||[]).includes('launch')) ids.push(a.id);
    }
    ids.sort();
    if (!ids.length) return;

    // Deterministic scatter
    const count = 42;
    for (let i=0;i<count;i++){
      let px = 120 + frand() * (world.w - 240);
      let py = 120 + frand() * (world.h - 240);
      // Avoid water tiles for props (readability + collision sanity)
      if (stageTiles){
        let tries = 0;
        while (tries++ < 10 && isWaterWorld(px, py)){
          px = 120 + frand() * (world.w - 240);
          py = 120 + frand() * (world.h - 240);
        }
      }
      const assetId = ids[i % ids.length];
      const meta = assets.get(assetId)?.meta || { w:64, h:64 };
      const w = meta.w || 64;
      const h = meta.h || 64;
      // Collision radius based on *footprint*, not the full sprite height.
      // Some props are tall (stalls/walls/pillars) and need a larger blocker.
      const name = String(assetId||'');
      const base = Math.max(w, h);
      let k = 0.34;
      if (name.includes('wall') || name.includes('stall')) k = 0.45;
      if (name.includes('rock_large')) k = 0.40;
      const r = clamp(base * k, 24, 90);
      stageProps.push({ x: px, y: py, r, assetId, w, h, _metaDirty: true });
    }
  }

  // Prop images are loaded async; once available, refresh draw size + collider once.
  function refreshStagePropMeta(){
    if (!stageProps.length) return;
    for (const pr of stageProps){
      if (!pr._metaDirty) continue;
      const img = assets.image(pr.assetId);
      if (!img || !img.width || !img.height) continue;
      pr.w = img.width;
      pr.h = img.height;
      const name = String(pr.assetId||'');
      const base = Math.max(pr.w, pr.h);
      let k = 0.34;
      if (name.includes('wall') || name.includes('stall')) k = 0.45;
      if (name.includes('rock_large')) k = 0.40;
      pr.r = clamp(base * k, 24, 90);
      pr._metaDirty = false;
    }
  }

  function resolveCircleVsProps(ent, radius){
    if (!stageProps.length) return;
    // Two passes prevents tunneling at higher speeds / low FPS.
    for (let pass=0; pass<2; pass++){
      for (const pr of stageProps){
        const dx = ent.x - pr.x;
        const dy = ent.y - pr.y;
        const rr = radius + (pr.r||0);
        const d2 = dx*dx + dy*dy;
        if (d2 > 0 && d2 < rr*rr){
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          const push = (rr - d) + 1.0;
          ent.x = clamp(ent.x + nx*push, 30, world.w-30);
          ent.y = clamp(ent.y + ny*push, 30, world.h-30);
        }
      }
    }
  }

  function clampToBossArena(ent, radius){
    if (!bossArena || !bossArena.active) return;
    const dx = ent.x - bossArena.cx;
    const dy = ent.y - bossArena.cy;
    const d = Math.hypot(dx, dy);
    const maxD = Math.max(0, bossArena.r - radius - 6);
    if (d > maxD && d > 0.0001){
      const nx = dx / d, ny = dy / d;
      ent.x = bossArena.cx + nx * maxD;
      ent.y = bossArena.cy + ny * maxD;
    }
  }

  function applyPlayerDamage(p, amount, srcX, srcY){
    if (!p || p.dead) return;
    if (p.invuln > 0) return;
    p.hp = Math.max(0, (p.hp|0) - (amount|0));
    try { profEnsure(p.creatureId); if (_profCreature) { _profCreature.damageTaken = (_profCreature.damageTaken||0) + (amount|0); profMark(); } } catch (_) {}
    p.invuln = 0.4;
    spawnFloater(p.x, p.y-14, amount|0, true);
    spawnHitRing(p.x, p.y);
    hitStopTimer = Math.max(hitStopTimer, 0.06);
    addShakeForDamage(amount|0);

    // knockback away from source
    const dx = p.x - srcX, dy = p.y - srcY;
    const [nx, ny] = norm(dx, dy);
    p.x = clamp(p.x + nx*18, 30, world.w-30);
    p.y = clamp(p.y + ny*18, 30, world.h-30);

    if (p.hp <= 0) p.dead = true;
  }


  const DIR = { DOWN: 0, UP: 1, RIGHT: 2, LEFT: 3 };
  function getMoveDir(vx, vy, lastDir) {
    if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) return lastDir;
    if (Math.abs(vx) > Math.abs(vy)) return vx >= 0 ? DIR.RIGHT : DIR.LEFT;
    return vy >= 0 ? DIR.DOWN : DIR.UP;
  }
  function dirName(d) { return d===0?'DOWN':d===1?'UP':d===2?'RIGHT':'LEFT'; }
  function playerFrame(state, t) {
    if (state === 'attack') return 5;
    if (state === 'walk') return 2 + ((t * 10) | 0) % 3;
    return ((t * 4) | 0) % 2;
  }

  let lastError = null;
  function _fmtErr(err){
    try{
      if (!err) return 'Unknown error';
      if (typeof err === 'string') return err;
      const name = err.name || 'Error';
      const msg = (err.message != null) ? String(err.message) : '';
      const stack = (err.stack != null) ? String(err.stack) : '';
      if (stack && msg && !stack.includes(msg)) return `${name}: ${msg}\n${stack}`;
      if (stack) return stack;
      if (msg) return `${name}: ${msg}`;
      return String(err);
    } catch (_) {
      return 'Error (failed to format)';
    }
  }
  window.addEventListener('error', (e)=>{
    try{
      const err = (e && (e.error || e)) || e;
      const msg = (e && e.message) ? String(e.message) : '';
      const formatted = _fmtErr(err);
      lastError = (msg && !formatted.includes(msg)) ? `${msg}\n${formatted}` : formatted;
    } catch (_){ lastError = 'error'; }
  });
  let lastTouchedEnemy = null; // {spriteId,ai,x,y}
  let lastProjectileKind = null;
  let running = false;
  let pausedForChoice = false;

  let player = null;
  let enemies = [];
  let projectiles = [];
  let weaponVfx = []; // animated weapon swings / stomps (visual-only, damage applied on fire)
  let xpGems = []; // {x,y,vx,vy,life,value}
  let xp = 0, level = 1, xpToNext = 10;

  let seed = 1337;
  function reseed() { seed = (seed * 1103515245 + 12345) >>> 0; return seed; }
  function frand() { return (reseed() / 4294967296); }

  async function startRun() {
    try {
      await ensureRuntime();
      const enforced = spawns.enforceLaunchScope({ ...menuSel }, menuSel.showExperimental);
      menuSel = { ...menuSel, ...enforced };

      runMode = pendingMode || 'solo_auto';
      // Create/clear player2 depending on mode
      player2 = null;
      if (runMode === 'coop_auto' || runMode === 'pvp_aim') {
        player2 = null; // will be spawned in restartRun after player exists
      }

      lastError = null;
      showScreen('ingame');
      running = true;
      restartRun();
      requestAnimationFrame(loop);
    } catch (err) {
      running = false;
      lastError = _fmtErr(err);
      diag.warn('START_RUN_FAILED', { err: String(lastError).slice(0,200) });
      // Keep ingame screen visible so error overlay can be seen.
      showScreen('ingame');
    }
  }

  function restartRun() {
    if (!running) return;

    let creatureId = menuSel.creatureId;
    let c = content.creature(creatureId);
    if (!c) {
      const list = content.listCreatures(false);
      if (list && list.length) {
        creatureId = list[0].id;
        menuSel.creatureId = creatureId;
        c = content.creature(creatureId);
      }
    }
    if (!c) {
      diag.warn('CREATURE_MISSING_AT_START', { creatureId: menuSel.creatureId });
      return;
    }

    seed = 1337;
    mutations.reset(1337);

    // Stage sizing + tile variance (Stage 1: Meadow Market)
    applyStageWorldSizing();
    ensureStageGroundTiles();

    player = {
      creatureId,
      weaponFamilyId: menuSel.weaponFamilyId || null,
      weaponId: menuSel.weaponId || null,
      x: world.w/2, y: world.h/2,
      vx: 0, vy: 0,
      dir: DIR.DOWN,
      hp: c.baseMaxHp || 120,
      maxHp: c.baseMaxHp || 120,
      moveSpeed: c.baseMoveSpeed || 4.0,
      fireCadence: (c.autoAttackSpec?.cadence) || 0.8,
      range: (c.autoAttackSpec?.range) || 6.0,
      damage: (c.autoAttackSpec?.damage) || 4.0,
      lastShot: 0,
      r: 18,
      invuln: 0,
      dead: false,
    };

    // Signature weapon override (Bible-ready schema: runtime/content.json -> weapons[])
    try {
      const sig = content.weaponForCreature?.(creatureId) || null;
      if (sig && sig.attackProfile){
        player.weaponId = sig.weaponId || sig.id || player.weaponId;
        const ap = sig.attackProfile;
        const totalF = Number(ap.windupFrames||0) + Number(ap.activeFrames||0) + Number(ap.recoveryFrames||0);
        if (isFinite(totalF) && totalF > 0) player.fireCadence = Math.max(0.12, totalF/60);
        // Range hint (used for auto-aim target selection and projectile ranges elsewhere)
        player.range = Math.max(player.range||3.6, 5.0);
      }
    } catch(_){ }
    // Avoid spawning in water (Meadow)
    if (stageTiles && isWaterWorld(player.x, player.y)){
      // Spiral search outward for first non-water tile.
      for (let r=1; r<18; r++){
        const ang = frand()*Math.PI*2;
        const tx = clamp(player.x + Math.cos(ang)*r*stageTiles.tile, 80, world.w-80);
        const ty = clamp(player.y + Math.sin(ang)*r*stageTiles.tile, 80, world.h-80);
        if (!isWaterWorld(tx, ty)){ player.x = tx; player.y = ty; break; }
      }
    }

// Profile: start run accounting (per-creature)
    try {
      profEnsure(creatureId);
      if (_profCreature) {
        _profCreature.runs = (_profCreature.runs|0) + 1;
        _profCreature.lastPlayedAt = Date.now();
        profMark();
        profFlush();
      }
    } catch (_) {}

    // Spawn Player 2 for Co-op / PvP (local 2P).
    player2 = null;
    if ((runMode === 'coop_auto' || runMode === 'pvp_aim') && net.role !== 'client'){
      player2 = {
        creatureId,
        weaponFamilyId: menuSel.weaponFamilyId || null,
        weaponId: menuSel.weaponId || null,
        x: world.w/2 + 60, y: world.h/2 + 30,
        vx: 0, vy: 0,
        dir: DIR.DOWN,
        hp: c.baseMaxHp || 120,
        maxHp: c.baseMaxHp || 120,
        moveSpeed: c.baseMoveSpeed || 2.0,
        damage: 8,
        range: 5,
        fireCadence: 0.22,
        lastShot: 0,
        r: 18,
        invuln: 0,
        dead: false
      };

      try {
        const sig = content.weaponForCreature?.(creatureId) || null;
        if (sig && sig.attackProfile){
          player2.weaponId = sig.weaponId || sig.id || player2.weaponId;
          const ap = sig.attackProfile;
          const totalF = Number(ap.windupFrames||0) + Number(ap.activeFrames||0) + Number(ap.recoveryFrames||0);
          if (isFinite(totalF) && totalF > 0) player2.fireCadence = Math.max(0.12, totalF/60);
        }
      } catch(_){ }
    }
    enemies = [];
    projectiles = [];
    xpGems = [];
    xp = 0; level = 1; xpToNext = 10;

    // Reset run-level systems
    runTimeSec = 0;
    bossSpawned = false;
    bossArena = null;
    hitStopTimer = 0;
    shakeTimer = 0; shakeMag = 0;
    floaters = [];
    hitRings = [];
    weaponZones = [];
    initStageProps();
    pausedForChoice = false;
    gamePaused = false;
    gameOver = false;
    if (elPauseOverlay) elPauseOverlay.classList.add('hidden');
    elOverlay.classList.add('hidden');
  }

  function applyMutationEffects(mutId) {
    // mutId may be a legacy mutation id OR an evolution node id.
    const node = content.evolutionNode?.(mutId);
    const m = node ? null : content.mutation(mutId);
    if (!node && !m) return;

    // --- Evolution Node (Bible-driven) ---
    if (node) {
      const mods = Array.isArray(node.modules) ? node.modules : [];
      for (const mod of mods) {
        const t = mod?.type;
        const p = mod?.params || {};
        if (t === 'stat_mod' && !p.cosmeticOnly) {
          if (typeof p.hpPct === 'number') {
            player.maxHp = Math.round(player.maxHp * (1 + (p.hpPct/100)));
            player.hp = Math.min(player.hp + Math.round(player.maxHp * 0.15), player.maxHp);
          }
          if (typeof p.moveSpeedPct === 'number') {
            player.moveSpeed = clamp(player.moveSpeed * (1 + (p.moveSpeedPct/100)), 1.2, 10.0);
          }
          if (typeof p.damagePct === 'number') {
            player.damage = clamp(player.damage * (1 + (p.damagePct/100)), 1, 250);
          }
          if (typeof p.meleeRangePx === 'number') {
            // Represent melee range as projectile range bump (this prototype uses ranged auto-attacks).
            player.range = clamp(player.range + (p.meleeRangePx/32), 2, 14);
          }
          // Other stats (armor/shield/crit/etc) can be added later; fail-soft for now.
        }

        // Lightweight projectile pattern support, with strict caps to prevent perf collapse.
        if (t === 'spawn_projectile_pattern') {
          player._extraShots = clamp((player._extraShots||0) + 1, 0, 2);
          player._patternKind = String(p.kind || p.pattern || 'spread');
        }
        if (t === 'orbitals') {
          player._orbitals = clamp((player._orbitals||0) + (p.count||1), 0, 3);
        }
        // grant_weapon / upgrade_weapon: shown in UI; gameplay hook is future (fail-soft).
      }
      return;
    }

    // --- Legacy Mutation (kept for backward compatibility) ---
    for (const eff of (m.effects || [])) {
      if (eff.type === 'projectile_mod') {
        // Clamp aggressive multipliers to avoid runaway projectile spam / perf collapse.
        if (eff.bonusDamage) player.damage = clamp(player.damage * (1 + eff.bonusDamage), 1, 250);
        if (eff.bonusRange) player.range = clamp(player.range * (1 + eff.bonusRange), 2, 14);
        if (eff.bonusCadence) {
          const k = clamp((1 - eff.bonusCadence), 0.35, 1.0);
          player.fireCadence = clamp(player.fireCadence * k, 0.12, 2.5);
        }
      }
      if (eff.type === 'hp_mod') {
        if (eff.bonusMaxHp) {
          player.maxHp = Math.round(player.maxHp * (1 + eff.bonusMaxHp));
          player.hp = Math.min(player.hp + Math.round(player.maxHp * 0.2), player.maxHp);
        }
      }
    }
  }

  // Preload attachment/vfx sprites referenced by active picks so visuals can appear immediately./vfx sprites referenced by active picks so visuals can appear immediately.
  const _preloadedVisualAssets = new Set();
  function preloadPickedVisuals() {
    try {
      const ids = [];
      for (const mid of mutations.active) {
        const node = content.evolutionNode?.(mid);
        const m = node ? null : content.mutation(mid);
        if (!node && !m) continue;
        const vbs = m
          ? ((Array.isArray(m.visual_bindings) && m.visual_bindings.length)
              ? m.visual_bindings
              : ((m.attachmentSpriteId || m.slot) ? [{ type: 'attachment', anchor: m.slot, attachmentId: m.attachmentSpriteId }] : []))
          : ((node && Array.isArray(node.visuals) && node.visuals.length)
              ? node.visuals.map(v => ({ type: 'attachment', anchor: v.slot, attachmentId: v.attachmentSpriteId }))
              : []);

        for (const vb of vbs) {
          if (vb.type !== 'attachment') continue;
          let raw = vb.attachmentId || vb.spriteKey || (m ? m.attachmentSpriteId : null);
          if (!raw) continue;
          if (typeof raw === 'string' && raw.startsWith('attach/')) raw = raw.slice('attach/'.length);
          const candidates = [];
          if (typeof raw === 'string') {
            candidates.push(`attachment.${raw}.sprite`);
            if (raw.startsWith('vfx_')) candidates.push(`vfx.${raw.slice(4)}.sprite`);
            candidates.push(`vfx.${raw}.sprite`);
          }
          const resolved = candidates.find(aid => assets.get(aid));
          if (!resolved) continue;
          if (_preloadedVisualAssets.has(resolved)) continue;
          _preloadedVisualAssets.add(resolved);
          ids.push(resolved);
        }
      }
      if (ids.length) assets.preloadAssetIds(ids).catch(()=>{});
    } catch(_){ }
  }


  function spawnXPGems(x, y, value, count=1){
    for (let i=0;i<count;i++){
      const ang = frand()*Math.PI*2;
      const spd = 40 + frand()*60;
      xpGems.push({
        x: x + (frand()-0.5)*10,
        y: y + (frand()-0.5)*10,
        vx: Math.cos(ang)*spd,
        vy: Math.sin(ang)*spd,
        life: 18.0,
        value: value|0
      });
    }
  }

  function updateXPGems(dt){
    if (!xpGems.length) return;
    const px = player?.x ?? 0;
    const py = player?.y ?? 0;
    const attractR = 180;
    const pickupR = 26;
    const keep = [];
    for (const g of xpGems){
      g.life -= dt;

      // mild damping
      g.vx *= Math.pow(0.20, dt);
      g.vy *= Math.pow(0.20, dt);

      const dx = px - g.x;
      const dy = py - g.y;
      const d2 = dx*dx + dy*dy;

      if (d2 > 0.0001 && d2 < attractR*attractR){
        const d = Math.sqrt(d2);
        const ax = dx / d;
        const ay = dy / d;
        const pull = (120 + (attractR - d)*2.2);
        g.vx += ax * pull * dt;
        g.vy += ay * pull * dt;
      }

      g.x = clamp(g.x + g.vx*dt, 20, world.w-20);
      g.y = clamp(g.y + g.vy*dt, 20, world.h-20);

      if (d2 < pickupR*pickupR){
        grantXP(g.value);
        audio.play('assets/audio/crit.wav', { volume: 0.06 }).catch(()=>{});
        continue;
      }

      if (g.life > 0) keep.push(g);
    }
    xpGems = keep;
  }

  function grantXP(amount) {
    xp += amount;
    while (xp >= xpToNext) {
      xp -= xpToNext;
      level++;
      xpToNext = Math.round(xpToNext * 1.35 + 2);
      openChoiceOverlay();
      break;
    }
  }

  function openChoiceOverlay() {
    pausedForChoice = true;
    const choices = mutations.draftChoices(3, { creatureId: player?.creatureId });
    elOverlayTitle.textContent = 'Choose Evolution';
    elOverlaySub.textContent = `Level ${level} — pick 1`;
    elChoices.innerHTML = '';
    elOverlay.classList.remove('hidden');


// Keep choice panel centered in HUD space; if it overlaps HP/timer, push down slightly (bounded).
requestAnimationFrame(() => {
  const panel = elOverlay.querySelector('.panel') || elOverlay.firstElementChild;
  if (!panel) return;
  const rHud = getHudRects(window.innerWidth, window.innerHeight);
  const hp = rHud.hp;
  const timer = rHud.timer;
  const pr = panel.getBoundingClientRect();
  const overlap = Math.max(0, (hp.y + hp.h) - pr.top, (timer.y + timer.h) - pr.top);
  if (overlap > 0) {
    const dy = Math.min(overlap + 12, 96);
    panel.style.transform = `translateY(${Math.round(dy)}px)`;
  } else {
    panel.style.transform = '';
  }
});


    const cards = choices.map((id, idx) => {
      const node = content.evolutionNode?.(id);
      const mut = node ? null : content.mutation(id);
      const title = (node?.name || mut?.name || id);
      const desc = (node?.description || mut?.description || '');
      const tier = (node && node.tier != null) ? `T${node.tier}` : '';
      const branch = (node?.branch) ? String(node.branch).toUpperCase() : '';
      const slot = (node?.visuals && node.visuals[0]?.slot) ? String(node.visuals[0].slot).toUpperCase() : (mut?.slot ? String(mut.slot).toUpperCase() : '');
      const rarity = (node?.rarity || mut?.rarity || '').toUpperCase();
      const effects = node ? (Array.isArray(node.modules) ? node.modules.map(m => m.type).slice(0,4).join(', ') : '') : '';

      const el = document.createElement('div');
      el.className = 'card';
      const iconElId = `choiceIcon_${id}_${idx}`;
      el.innerHTML = `
        <div class="cardRow">
          <img id="${iconElId}" class="choiceIcon" alt="" />
          <div class="cardCol">
            <div class="cardTitleRow">
              <div class="cardTitle">${idx+1}. ${title}</div>
              <div class="badgeRow">
                ${tier ? `<span class="badge">${tier}</span>` : ``}
                ${branch ? `<span class="badge">${branch}</span>` : ``}
                ${slot ? `<span class="badge">${slot}</span>` : ``}
                ${rarity ? `<span class="badge badgeDim">${rarity}</span>` : ``}
              </div>
            </div>
            <div class="cardSub">${desc}</div>
            ${effects ? `<div class="cardHint">Modules: ${effects}${(node.modules && node.modules.length>4)?'…':''}</div>` : ``}
          </div>
        </div>
      `;

      // Resolve icon after insertion (fail-soft): registry icon -> attachment -> generated -> missing_asset.
      queueMicrotask(() => {
        const img = document.getElementById(iconElId);
        if (!img) return;
        let set = false;
        // 1) explicit node icon
        if (node && node.iconSpriteId){
          const cand = [`icon.${node.iconSpriteId}.sprite`, `ui.${node.iconSpriteId}.icon`, String(node.iconSpriteId)];
          for (const cid of cand){
            const a = assets.get(cid);
            if (a && a.url){ img.src = a.url; set = true; break; }
          }
        }
        // 2) node visual attachment
        if (!set){
          const attachmentId = (node && node.visuals && node.visuals[0] && node.visuals[0].attachmentSpriteId) ? node.visuals[0].attachmentSpriteId : (mut && mut.attachmentSpriteId ? mut.attachmentSpriteId : null);
          if (attachmentId){
            const a = assets.get(`attachment.${attachmentId}.sprite`) || assets.get(`vfx.${attachmentId}.sprite`);
            if (a && a.url){ img.src = a.url; set = true; }
          }
        }
        // 3) generated icon (slot-themed)
        if (!set){
          const cid = (player && player.creatureId) ? player.creatureId : (menuSel && menuSel.creatureId) ? menuSel.creatureId : 'sporeling';
          const c = visuals._getGeneratedAttachment(cid, `icon_${id}_${slot}`, slot || 'CHEST');
          try { img.src = c.toDataURL('image/png'); set = true; } catch(_){ }
        }
        if (!set){
          const miss = assets.get('ui.missing_asset.icon');
          if (miss && miss.url) img.src = miss.url;
        }
      });

      el.addEventListener('click', () => pickMutation(id));
      return el;
    });
    cards.forEach(c => elChoices.appendChild(c));

    window.onkeydown = (e) => {
      if (e.key === '1') pickMutation(choices[0]);
      if (e.key === '2') pickMutation(choices[1]);
      if (e.key === '3') pickMutation(choices[2]);
    };
  }

  function hideOverlay() {
    pausedForChoice = false;
    elOverlay.classList.add('hidden');
    const panel = elOverlay.querySelector('.panel') || elOverlay.firstElementChild;
    if (panel) panel.style.transform = '';
    window.onkeydown = null;
  }

  function pickMutation(id) {
    if (!id) return;
    mutations.add(id);
    applyMutationEffects(id);
    // Profile: track node picks per creature
    try {
      profEnsure(player?.creatureId);
      if (_profCreature) {
        if (!_profCreature.topNodes) _profCreature.topNodes = {};
        _profCreature.topNodes[id] = (_profCreature.topNodes[id]|0) + 1;
        profMark();
      }
    } catch (_) {}
    preloadPickedVisuals();
    hideOverlay();
  }

  // --- Simulation ---
  const FIXED_DT = 1/60;
  let acc = 0;
  let lastT = performance.now();
  let gameTime = 0; // deterministic simulation clock (seconds)

  
// --- Enemy variants (deterministic by spriteId) ---
function strHash(s){
  s = String(s||'');
  let h = 2166136261 >>> 0;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pickEnemyAI(spriteId){
  const h = strHash(spriteId);
  const k = h % 4;
  if (k === 0) return 'melee';
  if (k === 1) return 'ranged';
  if (k === 2) return 'spitter';
  return 'charger';
}

function spawnWave(dt) {
    // simple deterministic spawn rate scaled by level
    const rate = 0.6 + Math.min(2.0, level*0.08);
    if (frand() < rate * dt) {
      const ang = frand() * Math.PI * 2;
      const r = 420 + frand()*260;
      let ex = clamp(player.x + Math.cos(ang)*r, 40, world.w-40);
      let ey = clamp(player.y + Math.sin(ang)*r, 40, world.h-40);
      if (stageTiles){
        let tries = 0;
        while (tries++ < 8 && isWaterWorld(ex, ey)){
          const ang2 = frand() * Math.PI * 2;
          const r2 = 420 + frand()*260;
          ex = clamp(player.x + Math.cos(ang2)*r2, 40, world.w-40);
          ey = clamp(player.y + Math.sin(ang2)*r2, 40, world.h-40);
        }
      }
      const spriteId = spawns.pickEnemySpriteId();
      const ai = pickEnemyAI(spriteId);
const baseHp = 10 + level*2;
const baseSpeed = 1.15 + level*0.02;
// Small per-archetype tuning
const hpMul = (ai === 'charger') ? 1.25 : (ai === 'spitter' ? 0.95 : 1.0);
const spMul = (ai === 'ranged') ? 1.05 : (ai === 'charger' ? 1.15 : (ai === 'spitter' ? 0.9 : 1.0));
enemies.push({
  x: ex, y: ey,
  hp: Math.round(baseHp * hpMul),
  maxHp: Math.round(baseHp * hpMul),
  r: 22,
  speed: baseSpeed * spMul,
  spriteId,
  ai,
  t: 0,
  contactDamage: 6 + level*0.2,
  // Timers must be initialized to 0 (not undefined) so strict comparisons (=== 0) work.
  shootCd: frand()*0.6,
  aimT: 0,
  poisonCd: frand()*0.8,
  dashCd: 1.2 + frand()*1.0,
  windupDashT: 0,
  dashT: 0,
  meleeCd: 0,
  meleeTeleT: 0
});
    }
  }

  function listBossSheetIds() {
    const reg = assets._registry;
    const ids = [];
    for (const a of (reg?.assets || [])) {
      if ((a.tags || []).includes('boss') && a.type === 'spritesheet') ids.push(a.id);
    }
    ids.sort();
    return ids;
  }

  function toggleBoss() {
    // Only available in-run
    if (!player) return;
    if (boss) { boss = null; return; }
    const ids = listBossSheetIds();
    const sheetId = ids[0] || null;
    if (!sheetId) return;
    boss = {
      x: clamp(player.x + 220, 80, world.w-80),
      y: clamp(player.y + 0, 80, world.h-80),
      hp: 500,
      maxHp: 500,
      r: 44,
      speed: 0.85,
      sheetId,
      t: 0,
      scale: 2.0,
      state: 'intro',
      stateT: 0,
      animT: 0,
      atkCd: 0.8,
      enraged: false,
      lastX: clamp(player.x + 220, 80, world.w-80),
      lastY: clamp(player.y + 0, 80, world.h-80),
      _introSfx: false,
      _phaseSfx: false
    };
  }
  function spawnBossFromStage(){
    if (!player) return;
    if (boss) return;
    const stage = (menuSel && menuSel.stageId) ? content.stage(menuSel.stageId) : null;
    const bossId = stage?.bossId || null;
    let sheetId = bossId ? `boss.${bossId}.sheet` : null;
    if (!sheetId || !assets.get(sheetId)){
      const ids = listBossSheetIds();
      sheetId = ids[0] || null;
    }
    if (!sheetId) return;

    // Spawn near player but not overlapping
    const ang = frand() * Math.PI * 2;
    const dist = 260;
    const bx = clamp(player.x + Math.cos(ang)*dist, 80, world.w-80);
    const by = clamp(player.y + Math.sin(ang)*dist, 80, world.h-80);

    boss = {
      x: bx, y: by,
      hp: 2200,
      maxHp: 2200,
      r: 44,
      speed: 1.05,
      sheetId,
      t: 0,
      scale: 2.0,
      // Haylord state machine (telegraph -> slam -> recovery)
      state: 'intro',
      stateT: 0,
      animT: 0,
      atkCd: 0.8,
      enraged: false,
      lastX: bx,
      lastY: by,
      _introSfx: false,
      _phaseSfx: false
    };
  }



  function update(dt) {
    if (!player) return;
    if (net.role === 'client') return; // host-authoritative MVP
    diag.clearFrame();

    // Props load asynchronously; once images are available, refresh collider sizes.
    refreshStagePropMeta();

    // Pause / Game Over gate
    if (gamePaused || gameOver) return;
    if (player.dead && !gameOver) { showGameOver(); return; }


    // Run clock (used for boss countdown)
    runTimeSec += dt;
    gameTime += dt;
    // Profile: accumulate playtime (flush every ~5s)
    try {
      profEnsure(player?.creatureId);
      if (_profCreature) {
        _profCreature.playtimeSec = (_profCreature.playtimeSec||0) + dt;
        _profFlushT += dt;
        _profCreature.highestLevel = Math.max(_profCreature.highestLevel||1, level||1);
        profMark();
        if (_profFlushT >= 5.0) { _profFlushT = 0; profFlush(); }
      }
    } catch (_) {}


    // Tick invulnerability even during hitstop
    if (player && player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    if (player2 && player2.invuln > 0) player2.invuln = Math.max(0, player2.invuln - dt);

// Poison DoT (from spitter projectiles)
if (player && player.poisonT > 0){
  player.poisonT = Math.max(0, player.poisonT - dt);
  player._poisonTick = (player._poisonTick || 0) + dt;
  if (player._poisonTick >= 0.5){
    player._poisonTick = 0;
    applyPlayerDamage(player, 2 + level*0.05, player.x, player.y);
  }
} else if (player) {
  player._poisonTick = 0;
}
if (player2 && player2.poisonT > 0){
  player2.poisonT = Math.max(0, player2.poisonT - dt);
  player2._poisonTick = (player2._poisonTick || 0) + dt;
  if (player2._poisonTick >= 0.5){
    player2._poisonTick = 0;
    applyPlayerDamage(player2, 2 + level*0.05, player2.x, player2.y);
  }
} else if (player2) {
  player2._poisonTick = 0;
}


    if (shakeTimer > 0){
      shakeTimer = Math.max(0, shakeTimer - dt);
      if (shakeTimer === 0) shakeMag = 0;
    }

    // Update lightweight visuals (numbers / rings)
    for (const f of floaters){ f.y += f.vy * dt; f.life -= dt; }
    floaters = floaters.filter(f => f.life > 0);
    for (const h of hitRings){ h.life -= dt; }
    hitRings = hitRings.filter(h => h.life > 0);
    for (const tl of telegraphs){ tl.life -= dt; }
    telegraphs = telegraphs.filter(tl => tl.life > 0);
    for (const pd of puddles){ pd.life -= dt; }
    puddles = puddles.filter(pd => pd.life > 0);

    // Signature weapon zones: tick damage to enemies/boss while they remain inside.
    for (const z of weaponZones){
      z.life -= dt;
      z.tickT += dt;
      if (z.tickT >= z.tickEvery){
        z.tickT = 0;
        const r = z.r || 60;
        const rr = r*r;
        for (const e of enemies){
          const dx = e.x - z.x, dy = e.y - z.y;
          if (dx*dx + dy*dy <= rr){
            e.hp -= (z.dmg|0);
            spawnHitRing(e.x, e.y, { life: 0.18, r0: 5 });
          }
        }
        if (boss){
          const dx = boss.x - z.x, dy = boss.y - z.y;
          if (dx*dx + dy*dy <= rr){
            boss.hp -= (z.dmg|0);
            spawnHitRing(boss.x, boss.y, { life: 0.18, r0: 7 });
          }
        }
      }
    }
    weaponZones = weaponZones.filter(z => z.life > 0);

    // On-hit tethers (venomcoil): periodic damage while close.
    for (const e of enemies){
      if (e._tether && e._tether.t > 0){
        e._tether.t = Math.max(0, e._tether.t - dt);
        e._tether.tick = (e._tether.tick||0) + dt;
        if (e._tether.tick >= (e._tether.every||0.2)){
          e._tether.tick = 0;
          const src = e._tether.src;
          const range = e._tether.range||150;
          const dx = (src?.x||e.x) - e.x, dy = (src?.y||e.y) - e.y;
          if (dx*dx + dy*dy <= range*range){
            const dealt = Math.max(1, Math.round((e._tether.mult||0.25) * ((src?._baseDamage ?? src?.damage ?? 8))));
            e.hp -= dealt;
            spawnHitRing(e.x, e.y, { life: 0.16, r0: 4, color: 'rgba(160,255,140,0.7)' });
          }
        }
      }
    }

    for (const wv of weaponVfx){ wv.life -= dt; }
    weaponVfx = weaponVfx.filter(wv => wv.life > 0);

    // Puddles: slow + light DoT while standing in them
    if ((player && !player.dead) || (player2 && !player2.dead)){
      for (const pd of puddles){
        const r = pd.r || 46;
        if (player && !player.dead){
          const dx = player.x - pd.x, dy = player.y - pd.y;
          if (dx*dx + dy*dy <= r*r){
            player._puddleSlow = Math.max(player._puddleSlow||0, 0.35);
            player.poisonT = Math.max(player.poisonT||0, 0.8);
          }
        }
        if (player2 && !player2.dead){
          const dx2 = player2.x - pd.x, dy2 = player2.y - pd.y;
          if (dx2*dx2 + dy2*dy2 <= r*r){
            player2._puddleSlow = Math.max(player2._puddleSlow||0, 0.35);
            player2.poisonT = Math.max(player2.poisonT||0, 0.8);
          }
        }
      }
    }

    // Hitstop freeze (combat weight)
    if (hitStopTimer > 0){
      hitStopTimer = Math.max(0, hitStopTimer - dt);
      return;
    }

    // Boss trigger: stop "growth" systems and lock into an arena ring before spawning the boss.
    if (!bossSpawned && runTimeSec >= BOSS_COUNTDOWN_SEC){
      bossSpawned = true;
      // Arena ring centers on player at trigger time.
      bossArena = { active: true, cx: player.x, cy: player.y, r: BOSS_BORDER_RADIUS_PX, t0Ms: performance.now() };
      toast('Boss approaching — arena locked!');
    }
    // Spawn boss shortly after the ring appears.
    if (bossSpawned && !boss && bossArena && bossArena.active){
      const dtMs = performance.now() - bossArena.t0Ms;
      if (dtMs >= BOSS_SPAWN_DELAY_MS){
        spawnBossFromStage();
        // Ensure boss spawns inside ring with minimum distance.
        if (boss){
          const dx = boss.x - bossArena.cx, dy = boss.y - bossArena.cy;
          const d = Math.hypot(dx, dy) || 1;
          const minD = BOSS_SPAWN_MIN_DISTANCE_PX;
          if (d < minD){
            boss.x = bossArena.cx + (dx/d) * minD;
            boss.y = bossArena.cy + (dy/d) * minD;
          }
        }
      }
    }


    // input movement
    const prevPX = player.x;
    const prevPY = player.y;
    let mx = 0, my = 0;
    // Player 1 movement: WASD always; arrow keys only when not in 2P modes.
    if (keys.has('w')) my -= 1;
    if (keys.has('s')) my += 1;
    if (keys.has('a')) mx -= 1;
    if (keys.has('d')) mx += 1;
    if (!player2 && net.role === 'offline'){
      if (keys.has('arrowup')) my -= 1;
      if (keys.has('arrowdown')) my += 1;
      if (keys.has('arrowleft')) mx -= 1;
      if (keys.has('arrowright')) mx += 1;
    }

    // Touch movement (left-side virtual stick)
    if (touchCtl.moveId !== null){
      mx += clamp(touchCtl.moveVec.x / 42, -1, 1);
      my += clamp(touchCtl.moveVec.y / 42, -1, 1);
    }

    // Basic gamepad support (P1): left stick move; A/RT fire; right stick aim (optional)
    let gpFire = false;
    let gpAim = { x: 0, y: 0 };
    try {
      const gp = (navigator.getGamepads && navigator.getGamepads()[0]) ? navigator.getGamepads()[0] : null;
      if (gp && gp.connected){
        const lx = gp.axes?.[0] ?? 0;
        const ly = gp.axes?.[1] ?? 0;
        if (Math.abs(lx) > 0.12) mx += lx;
        if (Math.abs(ly) > 0.12) my += ly;
        const rx = gp.axes?.[2] ?? 0;
        const ry = gp.axes?.[3] ?? 0;
        if (Math.abs(rx) > 0.16 || Math.abs(ry) > 0.16){ gpAim.x = rx; gpAim.y = ry; }
        gpFire = !!(gp.buttons?.[0]?.pressed || gp.buttons?.[7]?.pressed || gp.buttons?.[6]?.pressed);
      }
    } catch(_){ }
    const [nx, ny] = norm(mx, my);
    if (player._puddleSlow > 0) player._puddleSlow = Math.max(0, player._puddleSlow - dt);
    const slowMul = (player._puddleSlow > 0) ? 0.72 : 1.0;
    player.vx = nx * (player.moveSpeed||1.9) * slowMul * 60 * dt;
    player.vy = ny * (player.moveSpeed||1.9) * slowMul * 60 * dt;
    player.x = clamp(player.x + player.vx, 30, world.w-30);
    player.y = clamp(player.y + player.vy, 30, world.h-30);

    // Stage blocker collision
    resolveCircleVsProps(player, player.r || 18);
    if (player2){
      let mx2 = 0, my2 = 0;
      // Offline 2P uses arrow keys; Online HOST drives P2 from remote input packets.
      if (net.role === 'host' && net._remoteInput){
        mx2 = clamp(Number(net._remoteInput.mvx||0), -1, 1);
        my2 = clamp(Number(net._remoteInput.mvy||0), -1, 1);
        // Mirror remote aim into mouse2 for downstream code paths if needed.
        if (!player2._netAim) player2._netAim = { x: player2.x, y: player2.y };
        player2._netAim.x = Number(net._remoteInput.aimx||player2.x);
        player2._netAim.y = Number(net._remoteInput.aimy||player2.y);
        player2._netFire = !!net._remoteInput.fire;
      } else {
        if (keys.has('arrowup')) my2 -= 1;
        if (keys.has('arrowdown')) my2 += 1;
        if (keys.has('arrowleft')) mx2 -= 1;
        if (keys.has('arrowright')) mx2 += 1;
        player2._netFire = false;
      }
      const [nx2, ny2] = norm(mx2, my2);
      if (player2._puddleSlow > 0) player2._puddleSlow = Math.max(0, player2._puddleSlow - dt);
      const slow2 = (player2._puddleSlow > 0) ? 0.72 : 1.0;
      player2.vx = nx2 * (player2.moveSpeed||1.9) * slow2 * 60 * dt;
      player2.vy = ny2 * (player2.moveSpeed||1.9) * slow2 * 60 * dt;
      player2.x = clamp(player2.x + player2.vx, 30, world.w-30);
      player2.y = clamp(player2.y + player2.vy, 30, world.h-30);

      resolveCircleVsProps(player2, player2.r || 18);
      player2.dir = getMoveDir(player2.vx, player2.vy, player2.dir);
      // Player 2 aim direction for PvP (IJKL), stored as a normalized vector.
      let ax = 0, ay = 0;
      if (keys.has('i')) ay -= 1;
      if (keys.has('k')) ay += 1;
      if (keys.has('j')) ax -= 1;
      if (keys.has('l')) ax += 1;
      if (ax !== 0 || ay !== 0){
        const [na, nb] = norm(ax, ay);
        p2Aim.x = na; p2Aim.y = nb;
      }
    }
    player.dir = getMoveDir(player.vx, player.vy, player.dir);

    // shooting
    const t = performance.now()/1000;

    function tryFire(p, aimDx, aimDy){
      if (!p) return;
      if ((t - p.lastShot) < (p.fireCadence||0.25)) return;

      // Signature weapon lookup (per-creature) overrides weaponFamily melee/profile.
      const sigWeapon = content.weaponForCreature?.(p.creatureId) || (p.weaponId ? content.weapon?.(p.weaponId) : null) || null;

      const wfRaw = content.weaponFamily?.(p.weaponFamilyId) || content.weaponFamily?.(String(p.weaponFamilyId||'').toUpperCase()) || null;
      const atk = wfRaw?.attack || null;
      const isMelee = !!(sigWeapon && sigWeapon.attackProfile) || !!(atk && atk.type && String(atk.type).toUpperCase() !== 'PROJECTILE');

      const ownerId = (p === player2) ? 2 : 1;
      if (!isMelee){
        // Safety caps: prevent pathological projectile counts from tanking performance.
        if (projectiles.length > 220) return;
        let owned = 0;
        for (let i=0;i<projectiles.length;i++) if (projectiles[i].owner === ownerId) owned++;
        if (owned > 36) return;
      }

      const [sx0, sy0] = norm(aimDx, aimDy);
      if (!isFinite(sx0) || !isFinite(sy0)) return;

      // Weapon-family driven ballistics (Bible-ish): speed/spread/damage from weapon family.
      // (wfRaw resolved above for melee/projectile branching)
      const proj = wfRaw?.projectile || {};
      const speed = Number(proj.speed || p._projSpeed || 520);
      const spread = Number(proj.spread || 0);
      const baseDmg = Number((p._baseDamage != null ? p._baseDamage : p.damage) || 8);
      const dmgMul = Number(p._damageMul || 1);
      const dmg = Math.max(1, Math.round(baseDmg * dmgMul));

      if (isMelee){
        // Signature melee weapons (Bible-ready) take precedence; otherwise fall back to legacy 4-shape melee.
        let didHit = false;
        if (sigWeapon && sigWeapon.attackProfile){
          didHit = applySignatureWeaponAttack(p, sigWeapon, sx0, sy0, dmg);
        // Fallback: if signature profile yields no hits (common for aura-style attacks), use legacy melee spec.
        if (!didHit) {
          try { didHit = !!applyMeleeAttack(p, wfRaw, atk, sx0, sy0, dmg); } catch(_){ }
        }
        } else {
          applyMeleeAttack(p, wfRaw, atk, sx0, sy0, dmg);
        }
        p.lastShot = t;

        // Hit SFX (signature registry -> fallback)
        if (didHit){
          try {
            const hitUrl = (sigWeapon && sigWeapon.sfx && sigWeapon.sfx.hit && content.content?.fxRegistry?.sfx?.[sigWeapon.sfx.hit]?.url)
              ? content.content.fxRegistry.sfx[sigWeapon.sfx.hit].url
              : null;
            if (hitUrl) audio.play(hitUrl, { volume: 0.08 }).catch(()=>{});
          } catch(_){ }
        }
        // Fire SFX for melee (fail-soft).
        try {
          const fireUrl = (sigWeapon && sigWeapon.sfx && sigWeapon.sfx.fire && content.content?.fxRegistry?.sfx?.[sigWeapon.sfx.fire]?.url)
            ? content.content.fxRegistry.sfx[sigWeapon.sfx.fire].url
            : null;
          if (fireUrl) audio.play(fireUrl, { volume: 0.07 }).catch(()=>{});
          else {
            const fireId = wfRaw?.sfx?.fire;
            if (fireId) audio.play(`assets/audio/${fireId}.wav`, { volume: 0.07 }).catch(()=>{});
            else audio.play('assets/audio/sfx_wood_fire.wav', { volume: 0.06 }).catch(()=>{});
          }
        } catch(_){ }
        return;
      }

      // Optional multi-shot from evolution nodes (host authoritative).
      const extra = Math.max(0, Math.min(6, (p._extraShots|0) || 0));
      const shots = 1 + extra;

      p.lastShot = t;

      // Weapon-family SFX (fail-soft): expects assets/audio/<sfxId>.wav.
      try {
        const fireId = wfRaw?.sfx?.fire;
        if (fireId) audio.play(`assets/audio/${fireId}.wav`, { volume: 0.06 }).catch(()=>{});
      } catch(_){}

      // Cosmetic kind drives sprite selection + trail tint.
// Prefer explicit weapon family projectile kind; fall back to id-based derived kind.
const fam = String(proj.kind || p.weaponFamilyId || wfRaw?.id || '').toLowerCase();
let kind = fam || 'default';
// Back-compat buckets (keeps old palette semantics if ids contain these tokens)
if (kind === 'default' || !kind){
  const f2 = String(p.weaponFamilyId||wfRaw?.id||'').toLowerCase();
  if (f2.includes('stone') || f2.includes('rock')) kind = 'stone';
  else if (f2.includes('wood') || f2.includes('bark') || f2.includes('thorn')) kind = 'wood';
  else if (f2.includes('fiber') || f2.includes('ink') || f2.includes('spore')) kind = 'fiber';
  else kind = 'default';
}

      // Symmetric spread around aim direction.
      const baseAng = Math.atan2(sy0, sx0);
      const step = (shots > 1) ? (spread || 0.22) : 0;

      for (let si=0; si<shots; si++){
        const off = (shots === 1) ? 0 : (si - (shots-1)/2) * step;
        const ang = baseAng + off;
        const sx = Math.cos(ang), sy = Math.sin(ang);
        projectiles.push({
          x: p.x, y: p.y,
          vx: sx * speed,
          vy: sy * speed,
          life: (p.range || 3.6) * 140,
          dmg,
          owner: ownerId,
          kind,
          r: 5,
          trail: []
        });
      }
    }

    function nearestEnemyTo(px, py){
      let best = null;
      let bd = 1e18;
      for (const e of enemies){
        const dx = e.x - px, dy = e.y - py;
        const d = dx*dx + dy*dy;
        if (d < bd){ bd = d; best = e; }
      }
      return best;
    }

    // Apply weapon family ballistics to player (affects cadence/damage/speed).
    try {
      const wf = content.weaponFamily?.(player.weaponFamilyId) || content.weaponFamily?.(String(player.weaponFamilyId||'').toUpperCase()) || null;
      if (wf && wf.projectile){
        player._baseDamage = Number(wf.projectile.damage || player._baseDamage || player.damage || 8);
        player.damage = player._baseDamage;
        player._projSpeed = Number(wf.projectile.speed || player._projSpeed || 520);
        const mul = Number(wf.projectile.fireRateMul || 1);
        if (isFinite(mul) && mul > 0) player.fireCadence = Math.max(0.08, player.fireCadence / mul);
      }
    } catch(_){}
    const enemiesAll = boss ? enemies.concat([boss]) : enemies;
    if (runMode === 'pvp_aim'){
      // Auto-fire weapons regardless of input (production combat core)
      updateWeapons(player, enemiesAll, dt);
      // P1 keeps current aimed mouse attack
      if (mouse.down){
        const dx = (mouse.x/zoom + cam.x) - player.x;
        const dy = (mouse.y/zoom + cam.y) - player.y;
        tryFire(player, dx, dy);
      }
      if (gpFire){
        const ax = (gpAim && (gpAim.x||gpAim.y)) ? gpAim.x : (player.dir===2?0: (player.dir===1||player.dir===3?1:-1));
        const ay = (gpAim && (gpAim.x||gpAim.y)) ? gpAim.y : (player.dir===0?-1: (player.dir===2?1:0));
        tryFire(player, ax, ay);
      }
      // P2 aimed keyboard attack (IJKL aim vector) + hold N to fire.
      // Online HOST: remote client can also hold-fire via input packets.
      if (player2 && (keys.has('n') || (net.role === 'host' && player2._netFire))){
        if (net.role === 'host' && player2._netAim){
          tryFire(player2, player2._netAim.x - player2.x, player2._netAim.y - player2.y);
        } else {
          tryFire(player2, p2Aim.x, p2Aim.y);
        }
      }
    } else {
      // Auto-attack modes: Vampire Survivors style (aim at nearest enemy)
      // Weapons auto-run (production combat core)
      updateWeapons(player, enemiesAll, dt);
      const e1 = nearestEnemyTo(player.x, player.y);
      if (e1){
        tryFire(player, e1.x - player.x, e1.y - player.y);
      }
      if (player2){
        const e2 = nearestEnemyTo(player2.x, player2.y);
        if (e2){
          tryFire(player2, e2.x - player2.x, e2.y - player2.y);
        }
      }
    }

    // enemies
    spawnWave(dt);
    for (const e of enemies) {
      e.t += dt;

      // Target is always player 1 for now (keeps readability)
      const tx = player.x, ty = player.y;
      let dx = tx - e.x;
      let dy = ty - e.y;
      let dist = Math.max(0.001, Math.hypot(dx, dy));
      let sx = dx / dist, sy = dy / dist;

      // Update per-archetype timers
      if (e.shootCd !== undefined) e.shootCd = Math.max(0, e.shootCd - dt);
      if (e.poisonCd !== undefined) e.poisonCd = Math.max(0, e.poisonCd - dt);
      if (e.dashCd !== undefined) e.dashCd = Math.max(0, e.dashCd - dt);
      if (e.dashT !== undefined) e.dashT = Math.max(0, e.dashT - dt);
      if (e.aimT !== undefined) e.aimT = Math.max(0, e.aimT - dt);
      if (e.windupDashT !== undefined) e.windupDashT = Math.max(0, e.windupDashT - dt);
      if (e.meleeCd !== undefined) e.meleeCd = Math.max(0, e.meleeCd - dt);
      if (e.meleeTeleT !== undefined) e.meleeTeleT = Math.max(0, e.meleeTeleT - dt);
      if (e._dashTrail && e._dashTrail.length){
        for (const tr of e._dashTrail) tr.life -= dt;
        e._dashTrail = e._dashTrail.filter(tr => tr.life > 0);
      }

      let mvx = 0, mvy = 0;

      if (e.ai === 'ranged') {
        
        // Kite at mid range, shoot bolts
        const desired = 240;
        if (dist < desired - 35) { mvx = -sx; mvy = -sy; }
        else if (dist > desired + 55) { mvx = sx; mvy = sy; }

        // Fire-after-windup: if we already have an aim vector and windup is done, shoot once.
        if (e.aimT === 0 && e._aimDx !== undefined && dist < 560) {
          const ax = e._aimDx, ay = e._aimDy;
          projectiles.push({
            x: e.x, y: e.y,
            vx: ax * 340,
            vy: ay * 340,
            life: 520,
            dmg: 7 + level*0.25,
            owner: 0,
            kind: 'bolt',
            trail: []
          });
          audio.beep({ freq: 660, dur: 0.05, type: 'square', volume: 0.03 }).catch(()=>{});
          spawnHitRing(e.x, e.y, { r0: 14, life: 0.20, color: '#fff2c6' });
          e._aimDx = undefined; e._aimDy = undefined;
          e.shootCd = 1.05 + frand()*0.35;
        }
        // Otherwise, start a windup if off cooldown and not already winding up.
        else if (e.aimT === 0 && e._aimDx === undefined && e.shootCd === 0 && dist < 520) {
          e.aimT = 0.26; // windup
          e._aimDx = sx; e._aimDy = sy;
          addTelegraphLine(e.x, e.y, e.x + sx*72, e.y + sy*72, { life: 0.26, color: 'rgba(255,214,138,0.95)' });
          spawnHitRing(e.x, e.y, { r0: 10, life: 0.18, color: '#ffd68a' });
        }
} else if (e.ai === 'spitter') {
        
        // Keep a bit farther, spit poison blobs that create small puddles
        const desired = 270;
        if (dist < desired - 35) { mvx = -sx; mvy = -sy; }
        else if (dist > desired + 65) { mvx = sx; mvy = sy; }

        // Fire-after-windup
        if (e.aimT === 0 && e._aimDx !== undefined && dist < 600) {
          const ax = e._aimDx, ay = e._aimDy;
          projectiles.push({
            x: e.x, y: e.y,
            vx: ax * 260,
            vy: ay * 260,
            life: 560,
            dmg: 4 + level*0.15,
            owner: 0,
            kind: 'poison',
            trail: []
          });
          audio.beep({ freq: 330, dur: 0.07, type: 'triangle', volume: 0.035 }).catch(()=>{});
          spawnHitRing(e.x, e.y, { r0: 16, life: 0.22, color: 'rgba(120,255,160,0.85)', fill: true });
          e._aimDx = undefined; e._aimDy = undefined;
          e.poisonCd = 1.35 + frand()*0.50;
        }
        // Otherwise, start a windup if off cooldown and not already winding up.
        else if (e.aimT === 0 && e._aimDx === undefined && e.poisonCd === 0 && dist < 560) {
          e.aimT = 0.30;
          e._aimDx = sx; e._aimDy = sy;
          addTelegraphLine(e.x, e.y, e.x + sx*66, e.y + sy*66, { life: 0.30, color: 'rgba(120,255,160,0.95)' });
          spawnHitRing(e.x, e.y, { r0: 12, life: 0.20, color: 'rgba(120,255,160,0.95)', fill: true });
        }
} else if (e.ai === 'charger') {
        // Periodic dash bursts
        if (e.windupDashT > 0) {
          // Telegraph: stop briefly before dashing
          mvx = 0; mvy = 0;
          addTelegraphLine(e.x, e.y, e.x + sx*86, e.y + sy*86, { life: 0.08, color: 'rgba(255,180,120,0.9)' });
        } else if (e.dashT > 0) {
          mvx = sx * 3.1;
          mvy = sy * 3.1;
          // Afterimage trail (cheap)
          if (!e._dashTrail) e._dashTrail = [];
          e._dashTrail.push({ x: e.x, y: e.y, life: 0.16 });
          if (e._dashTrail.length > 6) e._dashTrail.shift();
        } else {
          mvx = sx; mvy = sy;
          if (e.dashCd === 0 && dist < 420) {
            e.windupDashT = 0.18;
            e._pendingDash = true;
            spawnHitRing(e.x, e.y, { r0: 12, life: 0.18, color: 'rgba(255,180,120,0.85)' });
            e.dashCd = 1.25 + frand()*0.85;
          }
        }
        if (e.windupDashT === 0 && e.dashT === 0 && e._pendingDash){
          e._pendingDash = false;
          if (dist < 520) {
            e.dashT = 0.22 + frand()*0.10;
            audio.beep({ freq: 220, dur: 0.05, type: 'sawtooth', volume: 0.03 }).catch(()=>{});
          }
        }
      } else {
        // melee
        mvx = sx; mvy = sy;
        if (e.meleeCd === 0 && dist < 64) {
          e.meleeTeleT = 0.18;
          e.meleeCd = 0.95 + frand()*0.35;
          addTelegraphLine(e.x, e.y, e.x + sx*52, e.y + sy*52, { life: 0.18, color: 'rgba(255,210,160,0.85)' });
        }
        if (e.meleeTeleT === 0 && e._didMelee !== e.meleeCd) {
          // Swing: short cone-ish hit (simple radius check)
          if (dist < 74) {
            applyPlayerDamage(player, Math.max(2, (e.contactDamage||6) * 0.6), e.x, e.y);
            spawnHitRing(player.x, player.y, { r0: 10, life: 0.18, color: 'rgba(255,210,160,0.85)' });
            audio.beep({ freq: 520, dur: 0.04, type: 'square', volume: 0.02 }).catch(()=>{});
          }
          e._didMelee = e.meleeCd;
        }
      }

      // Apply movement
      const [nx, ny] = norm(mvx, mvy);
      e.x += nx * e.speed * 90 * dt;
      e.y += ny * e.speed * 90 * dt;

      // Enemies intentionally ignore stage prop collision (threat / pressure).
      e.x = clamp(e.x, 30, world.w-30);
      e.y = clamp(e.y, 30, world.h-30);
      clampToBossArena(e, e.r||22);
    }

    // boss (debug parity)
    if (boss) {
      boss.t += dt;
      const dx = player.x - boss.x;
      const dy = player.y - boss.y;
      const [sx, sy] = norm(dx, dy);
      boss.x += sx * boss.speed * 90 * dt;
      boss.y += sy * boss.speed * 90 * dt;
      // Boss intentionally ignores stage prop collision (more threat / pressure).
    }

    
    // Contact: player can pass through enemies, but contact applies friction (NO damage).
    const pRad = player.r || 18;
    const pMoveDist = Math.hypot(player.vx||0, player.vy||0);
    const pSpeed = (dt > 0) ? (pMoveDist / dt) : 0;
    let contactFriction = 0;
    for (const e of enemies){
      const dx = e.x - player.x, dy = e.y - player.y;
      const rr = (e.r||22) + pRad;
      const d2 = dx*dx + dy*dy;
      if (d2 <= rr*rr){
        lastTouchedEnemy = { spriteId: e.spriteId || null, ai: e.ai || null, x: e.x, y: e.y };
        const d = Math.max(0.0001, Math.sqrt(d2));
        const overlap = rr - d;
        // Friction: reduce how much movement sticks when pushing into a crowd.
        // We "give" by lerping back toward pre-move position based on overlap.
        contactFriction = Math.max(contactFriction, clamp(overlap / rr, 0, 1) * 0.65);
      }
      if (player2){
        const dx2 = e.x - player2.x, dy2 = e.y - player2.y;
        const rr2 = (e.r||22) + (player2.r||18);
        const d22 = dx2*dx2 + dy2*dy2;
        if (d22 <= rr2*rr2){
          const d = Math.max(0.0001, Math.sqrt(d22));
          const overlap = rr2 - d;
          // Apply the same friction model to P2 by nudging toward their pre-move.
          const p2MoveDist = Math.hypot(player2.vx||0, player2.vy||0);
          const p2Speed = (dt > 0) ? (p2MoveDist / dt) : 0;
          player2._contactFriction = Math.max(player2._contactFriction||0, clamp(overlap / rr2, 0, 1) * 0.65);
        }
      }
    }
    if (boss){
      const dx = boss.x - player.x, dy = boss.y - player.y;
      const rr = (boss.r||44) + pRad;
      const d2 = dx*dx + dy*dy;
      if (d2 <= rr*rr){
        const d = Math.max(0.0001, Math.sqrt(d2));
        const overlap = rr - d;
        contactFriction = Math.max(contactFriction, clamp(overlap / rr, 0, 1) * 0.75);
      }
      if (player2){
        const dx2 = boss.x - player2.x, dy2 = boss.y - player2.y;
        const rr2 = (boss.r||44) + (player2.r||18);
        const d22 = dx2*dx2 + dy2*dy2;
        if (d22 <= rr2*rr2){
          const d = Math.max(0.0001, Math.sqrt(d22));
          const overlap = rr2 - d;
          player2._contactFriction = Math.max(player2._contactFriction||0, clamp(overlap / rr2, 0, 1) * 0.75);
          const p2MoveDist = Math.hypot(player2.vx||0, player2.vy||0);
          const p2Speed = (dt > 0) ? (p2MoveDist / dt) : 0;
          applyPlayerDamage(player2, 14, boss.x, boss.y);
        }
      }
    }

    // Apply friction after contact checks (keeps player pass-through but adds resistance)
    if (player && contactFriction > 0){
      player.x = lerp(player.x, prevPX, contactFriction);
      player.y = lerp(player.y, prevPY, contactFriction);
    }
    if (player2 && player2._contactFriction > 0){
      const prev2X = player2.x - (player2.vx||0);
      const prev2Y = player2.y - (player2.vy||0);
      player2.x = lerp(player2.x, prev2X, player2._contactFriction);
      player2.y = lerp(player2.y, prev2Y, player2._contactFriction);
      player2._contactFriction = 0;
    }

    // Boss (Haylord) state machine + VFX (golden leaf shedding, enrage cadence, intro zoom)
    if (boss){
      boss.t += dt;
      boss.animT = (boss.animT||0) + dt;
      const hpPct = (boss.maxHp>0) ? (boss.hp / boss.maxHp) : 1;
      const isEnrage = hpPct <= 0.30;

      if (isEnrage && !boss.enraged){
        boss.enraged = true;
        if (!boss._phaseSfx){
          boss._phaseSfx = true;
          audio.play('assets/audio/boss_phase_burst_0.wav', { volume: 0.16 }).catch(()=>{});
          audio.beep({ freq: 196, dur: 0.35, type:'triangle', volume: 0.04, attack: 0.01, release: 0.18 }).catch(()=>{});
        }
        addShake(8, 0.16);
        spawnHitRing(boss.x, boss.y, { r0: 58, life: 0.28, color: 'rgba(255,195,90,0.85)', fill: false });
      }

      // leaf shedding: emit when moving
      const dxm = boss.x - (boss.lastX||boss.x);
      const dym = boss.y - (boss.lastY||boss.y);
      const spd = Math.hypot(dxm, dym) / Math.max(0.0001, dt);
      if (spd > 0.5){
        const rate = (boss.enraged ? 18 : 10) * dt;
        const n = Math.floor(rate + frand());
        for (let i=0;i<n;i++){
          const a = frand()*Math.PI*2;
          const rr = 22 + frand()*34;
          const x = boss.x + Math.cos(a)*rr + (frand()-0.5)*8;
          const y = boss.y + Math.sin(a)*rr + (frand()-0.5)*8;
          bossLeaves.push({
            x, y,
            vx: (frand()-0.5)*26 + (-dxm/dt)*0.06,
            vy: (frand()-0.5)*26 + (-dym/dt)*0.06,
            life: 0.55 + frand()*0.45,
            life0: 1.0,
            rot: frand()*Math.PI*2,
            vr: (frand()-0.5)*6.0,
            scale: 0.7 + frand()*0.5
          });
        }
      }

      for (const lp of bossLeaves){
        lp.x += lp.vx * dt;
        lp.y += lp.vy * dt;
        lp.vx *= (1 - 1.6*dt);
        lp.vy *= (1 - 1.6*dt);
        lp.vy += 14*dt;
        lp.rot += lp.vr * dt;
        lp.life -= dt;
      }
      bossLeaves = bossLeaves.filter(p=>p.life > 0);

      if (!boss.state) boss.state = 'chase';
      boss.stateT = (boss.stateT||0) + dt;

      // intro: camera punch + bell toll
      if (boss.state === 'intro'){
        if (!boss._introSfx){
          boss._introSfx = true;
          audio.play('assets/audio/boss_spawn_0.wav', { volume: 0.16 }).catch(()=>{});
          audio.play('assets/audio/boss_intro_stinger_0.wav', { volume: 0.16 }).catch(()=>{});
          audio.beep({ freq: 196, dur: 0.85, type:'sine', volume: 0.05, attack: 0.01, release: 0.38 }).catch(()=>{});
        }
        const t = boss.stateT;
        const zIn = 0.55, zOut = 0.85;
        if (t < zIn){
          const u = t / zIn;
          bossZoomMul = lerp(bossZoomMul, 1.25, 0.16 + 0.84*u);
        } else if (t < zIn + zOut){
          const u = (t - zIn) / zOut;
          bossZoomMul = lerp(bossZoomMul, 1.0, 0.10 + 0.90*u);
        } else {
          bossZoomMul = lerp(bossZoomMul, 1.0, 0.12);
          boss.state = 'chase';
          boss.stateT = 0;
        }
      } else {
        bossZoomMul = lerp(bossZoomMul, 1.0, 0.08);
      }

      const atkBaseCd = boss.enraged ? 1.35 : 1.95;
      if (boss.atkCd == null) boss.atkCd = atkBaseCd;

      if (boss.state === 'chase'){
        boss.atkCd -= dt;
        const dx = player.x - boss.x, dy = player.y - boss.y;
        const [nx, ny] = norm(dx, dy);
        const chaseSpeed = boss.speed * (boss.enraged ? 1.25 : 1.0);
        boss.x = clamp(boss.x + nx * chaseSpeed * 120 * dt, 60, world.w-60);
        boss.y = clamp(boss.y + ny * chaseSpeed * 120 * dt, 60, world.h-60);
        clampToBossArena(boss, boss.r);

        const d2 = dx*dx + dy*dy;
        if (boss.atkCd <= 0 && d2 < (260*260)){
          boss.state = 'telegraph';
          boss.stateT = 0;
          boss.animT = 0;
          boss._slamX = player.x;
          boss._slamY = player.y;
          spawnHitRing(boss._slamX, boss._slamY, { r0: 44, life: boss.enraged ? 0.48 : 0.62, color: 'rgba(255,180,70,0.82)', fill: false });
          audio.play('assets/audio/telegraph_ring_0.wav', { volume: 0.10 }).catch(()=>{});
        }
      } else if (boss.state === 'telegraph'){
        const teleDur = boss.enraged ? 0.48 : 0.62;
        if (boss.stateT >= teleDur){
          boss.state = 'slam';
          boss.stateT = 0;
          boss.animT = 0;
          spawnHitRing(boss._slamX, boss._slamY, { r0: 78, life: 0.22, color: 'rgba(255,220,150,0.9)', fill: true });
          spawnHitRing(boss._slamX, boss._slamY, { r0: 60, life: 0.28, color: 'rgba(255,160,60,0.85)', fill: false });
          puddles.push({ x: boss._slamX, y: boss._slamY, r: 92, life: 0.8, kind: 'burn' });
          audio.play('assets/audio/boss_slam_0.wav', { volume: 0.18 }).catch(()=>{});
          addShake(12, 0.20);

          const slamR = boss.enraged ? 118 : 104;
          const slamR2 = slamR*slamR;
          const baseDmg = boss.enraged ? 34 : 26;
          if (player && !player.dead){
            const dxp = player.x - boss._slamX, dyp = player.y - boss._slamY;
            if (dxp*dxp + dyp*dyp <= slamR2) applyPlayerDamage(player, baseDmg, boss._slamX, boss._slamY);
          }
          if (player2 && !player2.dead){
            const dxp2 = player2.x - boss._slamX, dyp2 = player2.y - boss._slamY;
            if (dxp2*dxp2 + dyp2*dyp2 <= slamR2) applyPlayerDamage(player2, baseDmg, boss._slamX, boss._slamY);
          }

          const burst = boss.enraged ? 26 : 18;
          for (let i=0;i<burst;i++){
            const a = (i/burst)*Math.PI*2 + frand()*0.2;
            const sp = 85 + frand()*65;
            bossLeaves.push({
              x: boss._slamX + (frand()-0.5)*10,
              y: boss._slamY + (frand()-0.5)*10,
              vx: Math.cos(a)*sp,
              vy: Math.sin(a)*sp - 45,
              life: 0.65 + frand()*0.35,
              life0: 1.0,
              rot: frand()*Math.PI*2,
              vr: (frand()-0.5)*10.0,
              scale: 0.9 + frand()*0.7
            });
          }
        }
      } else if (boss.state === 'slam'){
        if (boss.stateT >= (boss.enraged ? 0.22 : 0.26)){
          boss.state = 'recover';
          boss.stateT = 0;
          boss.animT = 0;
        }
      } else if (boss.state === 'recover'){
        if (boss.stateT >= (boss.enraged ? 0.42 : 0.55)){
          boss.state = 'chase';
          boss.stateT = 0;
          boss.animT = 0;
          boss.atkCd = atkBaseCd + frand()*0.25;
        }
      }

      boss.lastX = boss.x;
      boss.lastY = boss.y;
    }

// projectiles
    for (const p of projectiles) {
      // Trail history (for unmistakable readability)
      if (!p.trail) p.trail = [];
      const low = prefs.get(LS.lowVfx,'0') === '1';
      const maxTrail = low ? 4 : 8;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > maxTrail) p.trail.shift();
	      // Previous position for swept collision and trail anchoring
	      const _ox = p.x, _oy = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p._ox = _ox; p._oy = _oy;
      p.life -= Math.hypot(p.vx, p.vy) * dt;
    }
    projectiles = projectiles.filter(p => p.life > 0);


    // Swept collision helpers (prevents tunneling on low-FPS mobile embeds)
    function _segDist2(ax, ay, bx, by, px, py){
      const abx = bx - ax, aby = by - ay;
      const apx = px - ax, apy = py - ay;
      const ab2 = abx*abx + aby*aby;
      let t = ab2 > 1e-9 ? (apx*abx + apy*aby) / ab2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const cx = ax + abx*t, cy = ay + aby*t;
      const dx = px - cx, dy = py - cy;
      return dx*dx + dy*dy;
    }
    function _segCircleHit(ax, ay, bx, by, cx, cy, r){
      return _segDist2(ax, ay, bx, by, cx, cy) <= r*r;
    }


    // collisions (deterministic order)
    enemies.sort((a,b)=> (a.x-b.x) || (a.y-b.y));
    for (const p of projectiles) {
      // Enemy projectiles hit players, not enemies.
      if (p.owner === 0){
        lastProjectileKind = p.kind || 'enemy';
        // hit player 1
        if (player && !player.dead){
          const dxp = player.x - p.x, dyp = player.y - p.y;
          const rr = (player.r||18);
          if (dxp*dxp + dyp*dyp <= rr*rr){
            // bolt = direct damage; poison = light hit + DoT
            if (p.kind === 'poison'){
              applyPlayerDamage(player, Math.max(1, (p.dmg|0)), p.x, p.y);
              player.poisonT = Math.max(player.poisonT||0, 2.5);
              puddles.push({ x: p.x, y: p.y, r: 54, life: 2.2, kind: 'poison' });
            } else {
              applyPlayerDamage(player, Math.max(1, (p.dmg|0)), p.x, p.y);
            }
            spawnHitRing(p.x, p.y, { r0: 14, life: 0.22, color: (p.kind==='poison') ? 'rgba(120,255,160,0.90)' : '#fff2c6', fill: (p.kind==='poison') });
            addShakeForDamage(p.dmg|0);
            p.life = 0;
            continue;
          }
        }
        // hit player 2 (if enabled)
        if (player2 && !player2.dead){
          const dxp2 = player2.x - p.x, dyp2 = player2.y - p.y;
          const rr2 = (player2.r||18);
          if (dxp2*dxp2 + dyp2*dyp2 <= rr2*rr2){
            if (p.kind === 'poison'){
              applyPlayerDamage(player2, Math.max(1, (p.dmg|0)), p.x, p.y);
              player2.poisonT = Math.max(player2.poisonT||0, 2.5);
              puddles.push({ x: p.x, y: p.y, r: 54, life: 2.2, kind: 'poison' });
            } else {
              applyPlayerDamage(player2, Math.max(1, (p.dmg|0)), p.x, p.y);
            }
            spawnHitRing(p.x, p.y, { r0: 14, life: 0.22, color: (p.kind==='poison') ? 'rgba(120,255,160,0.90)' : '#fff2c6', fill: (p.kind==='poison') });
            addShakeForDamage(p.dmg|0);
            p.life = 0;
            continue;
          }
        }
        continue;
      }
      for (const e of enemies) {
        const dx = e.x - p.x, dy = e.y - p.y;
        const er = (e && e.r) ? e.r : 22;
        if (dx*dx + dy*dy <= (er*er)) {
          if (e && e.hp != null) e.hp -= p.dmg;
          try { profEnsure(player?.creatureId); if (_profCreature) { _profCreature.damageDealt = (_profCreature.damageDealt||0) + (p.dmg|0); profMark(); } } catch (_) {}
          spawnFloater(e.x, e.y-18, p.dmg|0, false);
          spawnHitRing(e.x, e.y);
          hitStopTimer = Math.max(hitStopTimer, 0.04);
          addShakeForDamage(p.dmg|0);

          p.life = 0;
          break;
        }
      }
      if (boss) {
        const dx = boss.x - p.x, dy = boss.y - p.y;
        const br = (boss && boss.r) ? boss.r : 64;
        if (dx*dx + dy*dy <= (br*br)) {
          if (boss && boss.hp != null) boss.hp -= p.dmg;
          try { profEnsure(player?.creatureId); if (_profCreature) { _profCreature.damageDealt = (_profCreature.damageDealt||0) + (p.dmg|0); profMark(); } } catch (_) {}
          spawnFloater(boss.x, boss.y-26, p.dmg|0, false);
          spawnHitRing(boss.x, boss.y);
          hitStopTimer = Math.max(hitStopTimer, 0.06);
          addShakeForDamage(p.dmg|0, { bossImpact: true });

          p.life = 0;
        }
      }
    }
    projectiles = projectiles.filter(p => p.life > 0);

    // remove dead
    const alive = [];
    for (const e of enemies) {
      if (e.hp <= 0) {
        spawnXPGems(e.x, e.y, 3, 1);
        try { profEnsure(player?.creatureId); if (_profCreature) { _profCreature.kills = (_profCreature.kills|0) + 1; profMark(); } } catch (_) {}
      }
      else alive.push(e);
    }
    enemies = alive;

    // XP gems (drop on enemy death; picked up to gain XP)
    updateXPGems(dt);

    if (boss && boss.hp <= 0) {
      const bx = boss.x, by = boss.y;
      boss = null;
      // Boss drops a burst of XP gems instead of auto-granting XP.
      spawnXPGems(bx, by, 5, 12);
    }

    // camera (zoom-aware) (boss intro applies a temporary zoom punch)
    const _effZoomU = zoom * (bossZoomMul || 1.0);
    const viewW = canvas.width / _effZoomU;
    const viewH = canvas.height / _effZoomU;
    cam.x = player.x - viewW/2;
    cam.y = player.y - viewH/2;
    cam.x = clamp(cam.x, 0, world.w - viewW);
    cam.y = clamp(cam.y, 0, world.h - viewH);

    diag.state.entities = 1 + enemies.length + projectiles.length;
    if (boss) diag.state.entities += 1;
    diag.state.activeMutations = mutations.active.slice();
  }

  function draw() {
    // Enemy spritesheet frame cache (avoids accidental whole-sheet blits on some browsers/builds)
    const __efc = (window.__enemyFrameCache = window.__enemyFrameCache || {});
    function __getEnemyFrame(sheetId, sheet, meta, col, row){
      if (!sheetId || !sheet || !meta) return null;
      const cellW = meta.cellW|0, cellH = meta.cellH|0;
      const cols = Math.max(1, meta.cols|0 || ((sheet.width / cellW)|0) || 1);
      const rows = Math.max(1, meta.rows|0 || ((sheet.height / cellH)|0) || 1);
      const key = sheetId;
      let ent = __efc[key];
      if (!ent || ent._w !== sheet.width || ent._h !== sheet.height || ent.cellW !== cellW || ent.cellH !== cellH || ent.cols !== cols || ent.rows !== rows){
        ent = { _w: sheet.width, _h: sheet.height, cellW, cellH, cols, rows, frames: new Array(cols*rows), ready: false, _busy: false };
        __efc[key] = ent;
      }
      const idx = (row*cols + col) % ent.frames.length;
      const existing = ent.frames[idx];
      if (existing) return existing;
      // Lazily slice a single frame into an offscreen canvas (fast + deterministic)
      try {
        const oc = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(cellW, cellH) : document.createElement('canvas');
        oc.width = cellW; oc.height = cellH;
        const g = oc.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.clearRect(0,0,cellW,cellH);
        g.drawImage(sheet, col*cellW, row*cellH, cellW, cellH, 0, 0, cellW, cellH);
        ent.frames[idx] = oc;
        return oc;
      } catch (_) {
        return null;
      }
    }
    // background
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);


    if (lastError) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#ffd68a';
      ctx.font = '14px monospace';
      const msg = String(lastError);
      const lines = msg.split('\n').slice(0,8);
      let y = 24;
      ctx.fillText('Runtime Error (see console):', 20, y); y += 18;
      ctx.fillStyle = '#f2eeee';
      for (const ln of lines) { ctx.fillText(ln.slice(0,120), 20, y); y += 16; }

      // Compact snapshot (fail-soft diagnostics)
      y += 10;
      ctx.fillStyle = '#ffd68a';
      ctx.fillText('Snapshot:', 20, y); y += 16;
      ctx.fillStyle = '#f2eeee';
      const miss = (assets && assets._warned) ? assets._warned.size : 0;
      const p = (typeof player !== 'undefined' && player) ? player : null;
      const snap = [
        `player: ${p?`(${(p.x|0)},${(p.y|0)}) hp:${(p.hp??'?')}`:'(none)'}`,
        `lastEnemy: ${lastTouchedEnemy?`${lastTouchedEnemy.ai||'?'}:${lastTouchedEnemy.spriteId||'?'} @(${(lastTouchedEnemy.x|0)},${(lastTouchedEnemy.y|0)})`:'(none)'}`,
        `lastProj: ${lastProjectileKind||'(none)'}`,
        `missingAssets: ${miss}`
      ];
      for (const ln of snap){ ctx.fillText(ln.slice(0,120), 20, y); y += 16; }
      return;
    }


    // If player isn't ready, still draw HUD (and keep loop alive) instead of hard-returning.
    if (!player) {
      const hudRects = getHudRects(canvas.width, canvas.height);
      drawHudBase({ player: null, bossActive: false, runTimeSec: (typeof runTimeSec!=='undefined'?runTimeSec:0), xp: (typeof xp!=='undefined'?xp:0), xpToNext: (typeof xpToNext!=='undefined'?xpToNext:0), level: (typeof level!=='undefined'?level:0), activeMutations: (typeof mutations!=='undefined' && mutations && mutations.active) ? mutations.active : [] });
      ctx.save();
      ctx.setTransform(1,0,0,1,0,0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(hudCanvas, hudRects.ox, hudRects.oy, Math.round(640*hudRects.scale), Math.round(360*hudRects.scale));
      ctx.restore();
      diag.render();
      return;
    }

    // world render

    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const _effZoom = zoom * (bossZoomMul || 1.0);
    const viewW = canvas.width / _effZoom;
    const viewH = canvas.height / _effZoom;

    // Camera shake (combat weight)
    const baseCamX = cam.x, baseCamY = cam.y;
    if (shakeTimer > 0 && shakeMag > 0){
      cam.x = baseCamX + (frand() - 0.5) * 2 * shakeMag;
      cam.y = baseCamY + (frand() - 0.5) * 2 * shakeMag;
    }

    // World render (scaled). HUD draws after restore().
    ctx.save();
    ctx.scale(_effZoom, _effZoom);

    ctx.imageSmoothingEnabled = false;

    // Stage ground tiles (Meadow: grass/dirt/water variance)
    const grass = assets.image('core.grass');
    // lightweight generated tiles (cached on window)
    if (!window.__wlTiles){
      window.__wlTiles = {};
      window.__wlTiles.dirt = (function(){
        const c = document.createElement('canvas'); c.width=64; c.height=64;
        const g = c.getContext('2d'); g.imageSmoothingEnabled=false;
        // mottled dirt/plaza: palette-locked, non-primitive (noise + edge specks)
        const base = '#6b4a2a', hi = '#8a6438', lo = '#4b3420', speck='#a27a44';
        g.fillStyle = base; g.fillRect(0,0,64,64);
        for (let i=0;i<420;i++){
          const x = (Math.random()*64)|0, y = (Math.random()*64)|0;
          const r = Math.random();
          g.fillStyle = (r<0.33)?hi:((r<0.66)?lo:speck);
          g.fillRect(x,y,1,1);
        }
        // subtle cracks
        g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let i=0;i<24;i++){
          const x = (Math.random()*64)|0, y = (Math.random()*64)|0;
          g.fillRect(x,y, (Math.random()*6)|0, 1);
        }
        return c;
      })();
      window.__wlTiles.water = (function(){
        const c = document.createElement('canvas'); c.width=64; c.height=64;
        const g = c.getContext('2d'); g.imageSmoothingEnabled=false;
        const base = '#1e4f74', hi = '#2d6e9a', lo = '#173a52', foam='#7fd3ff';
        g.fillStyle = base; g.fillRect(0,0,64,64);
        for (let i=0;i<520;i++){
          const x = (Math.random()*64)|0, y = (Math.random()*64)|0;
          const r = Math.random();
          g.fillStyle = (r<0.45)?hi:((r<0.9)?lo:foam);
          g.fillRect(x,y,1,1);
        }
        // tiny wave highlights
        g.fillStyle = 'rgba(127,211,255,0.35)';
        for (let y=6;y<64;y+=10){
          for (let x=0;x<64;x+=14){
            g.fillRect(x+((y*3)%7), y, 6, 1);
          }
        }
        return c;
      })();
    }

    if (stageTiles && grass){
      const tw = 64, th = 64;
      const startTx = Math.floor(cam.x / tw);
      const startTy = Math.floor(cam.y / th);
      const endTx = Math.ceil((cam.x + viewW) / tw);
      const endTy = Math.ceil((cam.y + viewH) / th);
      for (let ty=startTy; ty<endTy; ty++){
        if (ty < 0 || ty >= stageTiles.rows) continue;
        for (let tx=startTx; tx<endTx; tx++){
          if (tx < 0 || tx >= stageTiles.cols) continue;
          const t = stageTiles.data[ty*stageTiles.cols + tx];
          const img = (t===2) ? window.__wlTiles.water : (t===1 ? window.__wlTiles.dirt : grass);
          const x = tx*tw - cam.x;
          const y = ty*th - cam.y;
          ctx.drawImage(img, x, y, tw, th);
        }
      }
    } else if (grass) {
      const tw = 64, th = 64;
      for (let y = -((cam.y|0)%th); y < viewH; y += th) {
        for (let x = -((cam.x|0)%tw); x < viewW; x += tw) {
          ctx.drawImage(grass, x, y, tw, th);
        }
      }
    }

    

    // XP gems (world items)
    if (xpGems.length){
      for (const g of xpGems){
        const sx = g.x - cam.x;
        const sy = g.y - cam.y;
        const pulse = 1 + Math.sin((performance.now()/1000)*6 + (g.x*0.01)) * 0.08;
        const s = 10 * pulse;
        ctx.fillStyle = 'rgba(80,220,255,0.95)';
        ctx.beginPath();
        ctx.moveTo(Math.round(sx), Math.round(sy - s));
        ctx.lineTo(Math.round(sx + s*0.7), Math.round(sy));
        ctx.lineTo(Math.round(sx), Math.round(sy + s));
        ctx.lineTo(Math.round(sx - s*0.7), Math.round(sy));
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(Math.round(sx-1), Math.round(sy-2), 2, 4);
      }
    }

    // Puddles (ground decals) - drawn below actors
    if (puddles.length){
      for (const pd of puddles){
        const sx = pd.x - cam.x;
        const sy = pd.y - cam.y;
        const r = pd.r || 46;
        const denom = (pd._life0 || (pd._life0 = pd.life || 2));
        const a = clamp(pd.life / Math.max(0.001, denom), 0, 1);
        ctx.fillStyle = (pd.kind==='poison') ? `rgba(80,220,140,${0.10 + a*0.18})` : `rgba(255,214,138,${0.10 + a*0.16})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = (pd.kind==='poison') ? `rgba(120,255,160,${0.18 + a*0.22})` : `rgba(255,214,138,${0.18 + a*0.22})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI*2);
        ctx.stroke();
      }
    }

    // Signature weapon zones (ground decals) - drawn below actors
    if (weaponZones.length){
      for (const z of weaponZones){
        const sx = z.x - cam.x;
        const sy = z.y - cam.y;
        const r = z.r || 60;
        const a = clamp(z.life / Math.max(0.001, z.life0||z.life||1), 0, 1);
        const low = prefs.get(LS.lowVfx,'0') === '1';
        const alpha = low ? (0.08 + a*0.10) : (0.10 + a*0.16);
        // damageType keyed hue via simple buckets (placeholder)
        const dt = String(z.dmgType||'').toLowerCase();
        const col = (dt.includes('burn')) ? `rgba(255,120,80,${alpha})`
                  : (dt.includes('toxin')||dt.includes('mire')) ? `rgba(90,255,160,${alpha})`
                  : (dt.includes('frost')) ? `rgba(120,210,255,${alpha})`
                  : (dt.includes('void')||dt.includes('corrupt')||dt.includes('echo')) ? `rgba(190,130,255,${alpha})`
                  : `rgba(255,214,138,${alpha})`;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = col.replace(`${alpha})`, `${Math.min(0.42, alpha+0.18)})`);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI*2);
        ctx.stroke();
      }
    }

        // Boss arena border (hard ring)
    if (bossArena && bossArena.active){
      const sx = bossArena.cx - cam.x;
      const sy = bossArena.cy - cam.y;
      const r = bossArena.r;
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(10,10,12,0.85)'; // iron-black
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI*2); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,214,138,0.70)'; // mutation amber accents
      ctx.beginPath(); ctx.arc(sx, sy, r-3, 0, Math.PI*2); ctx.stroke();
      // subtle inward glow
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(255,214,138,0.10)';
      ctx.beginPath(); ctx.arc(sx, sy, r-10, 0, Math.PI*2); ctx.stroke();
    }

// Depth-sorted world draw (props + actors) so tall props can occlude entities correctly.

    // boss leaf particles (golden shedding)
    if (bossLeaves && bossLeaves.length){
      const rf = prefs.get(LS.reducedFlashes,'1') === '1';
      ctx.save();
      ctx.globalAlpha = rf ? 0.55 : 0.75;
      for (const lp of bossLeaves){
        const a = clamp(lp.life / (lp.life0||1), 0, 1);
        const x = lp.x - cam.x, y = lp.y - cam.y;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(lp.rot||0);
        const s = 2.2 * (lp.scale||1);
        ctx.fillStyle = `rgba(255, 210, 110, ${0.35 + 0.55*a})`;
        ctx.fillRect(-s, -s*0.6, s*2, s*1.2);
        ctx.restore();
      }
      ctx.restore();
    }

    const drawables = [];
    for (const pr of stageProps) drawables.push({ kind: 'prop', y: pr.y, pr });
    for (const e of enemies) drawables.push({ kind: 'enemy', y: e.y, e });
    if (boss) drawables.push({ kind: 'boss', y: boss.y, boss });
    if (player) drawables.push({ kind: 'player', y: player.y, player });

    drawables.sort((a,b)=> (a.y-b.y) || (a.kind>b.kind?1:-1));

    for (const d of drawables){
      if (d.kind === 'prop'){
        const pr = d.pr;
        const img = assets.image(pr.assetId);
        const sx = pr.x - cam.x;
        const sy = pr.y - cam.y;
        if (img){
          ctx.drawImage(img, Math.round(sx - pr.w/2), Math.round(sy - pr.h/2), pr.w, pr.h);
        } else {
          ctx.fillStyle = 'rgba(40,30,20,0.9)';
          ctx.fillRect(Math.round(sx-16), Math.round(sy-16), 32, 32);
        }
      } else if (d.kind === 'enemy'){
        const e = d.e;
        const sx = e.x - cam.x;
        const sy = e.y - cam.y;

        // Charger dash afterimage streak
        if (e._dashTrail && e._dashTrail.length && prefs.get(LS.lowVfx,'0') !== '1'){
          for (const tr of e._dashTrail){
            const a = clamp(tr.life / 0.16, 0, 1);
            ctx.fillStyle = `rgba(255,180,120,${0.05 + a*0.18})`;
            ctx.fillRect(Math.round(tr.x - cam.x - 18), Math.round(tr.y - cam.y - 18), 36, 36);
          }
        }

        const sheetId = e.spriteId ? assets.enemySheetAssetId(e.spriteId) : null;
        const sheet = sheetId ? assets.image(sheetId) : null;
        const meta = sheetId ? assets.get(sheetId)?.meta : null;
        if (sheet && meta) {
          // Enemy sheets are production-locked: 384×320, 6×5, 64×64.
          // Do not trust meta at runtime (prevents accidental half/quarter slicing regressions).
          const cols = 6;
          const rows = 5;
          const cellW = 64;
          const cellH = 64;
          const col = (((e.t*6)|0) % cols);
          const row = 0;

          const s = (e.scale != null) ? e.scale : 1;
          const dw = Math.round(cellW * s);
          const dh = Math.round(cellH * s);
          const frame = __getEnemyFrame(sheetId, sheet, meta, col, row);
          if (frame){
            ctx.drawImage(frame, Math.round(sx - dw/2), Math.round(sy - dh/2), dw, dh);
          } else {
            ctx.drawImage(sheet, col*cellW, row*cellH, cellW, cellH, Math.round(sx - dw/2), Math.round(sy - dh/2), dw, dh);
          }
          const hpPct = clamp(e.hp / (e.maxHp|| (10+level*2)), 0, 1);
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(Math.round(sx-18), Math.round(sy-44), 36, 5);
          ctx.fillStyle = 'rgba(255,120,120,0.9)';
          ctx.fillRect(Math.round(sx-18), Math.round(sy-44), Math.round(36*hpPct), 5);
        } else {
          ctx.fillStyle = '#c25555';
          ctx.fillRect(Math.round(sx-10), Math.round(sy-10), 20, 20);
        }
      } else if (d.kind === 'boss'){
        const b = d.boss;
        const sx = b.x - cam.x;
        const sy = b.y - cam.y;
        const sheet = assets.image(b.sheetId);
        const meta = assets.get(b.sheetId)?.meta;
        if (sheet && meta) {
          const cellW = meta.cellW, cellH = meta.cellH;
          const cols = Math.max(1, meta.cols || ((sheet.width / cellW)|0));
          // Boss-specific animation rows (Bible timing): 0=chase/idle, 1=telegraph, 2=slam, 3=recovery
          const st = b.state || 'chase';
          let row = 0;
          if (st === 'telegraph') row = 1;
          else if (st === 'slam') row = 2;
          else if (st === 'recover') row = 3;

          const animCols = Math.min(4, cols);
          const speed = (st === 'telegraph') ? 10 : (st === 'slam' ? 12 : (st === 'recover' ? 8 : 6));
          const col = (((b.animT||b.t) * speed)|0) % animCols;

          const dw = Math.round(cellW * b.scale);
          const dh = Math.round(cellH * b.scale);

          // Enrage glow (under 30% HP): warm rim light (reduced-flash aware)
          const rf = prefs.get(LS.reducedFlashes,'1') === '1';
          if (b.enraged){
            ctx.save();
            ctx.globalAlpha = rf ? 0.20 : 0.30;
            ctx.fillStyle = 'rgba(255,190,90,1)';
            ctx.beginPath(); ctx.arc(sx, sy, 74, 0, Math.PI*2); ctx.fill();
            ctx.restore();
          }

          ctx.drawImage(sheet, col*cellW, row*cellH, cellW, cellH, Math.round(sx - dw/2), Math.round(sy - dh/2), dw, dh);
        } else {
          ctx.fillStyle = '#b04ce1';
          ctx.fillRect(Math.round(sx-40), Math.round(sy-40), 80, 80);
        }

      } else if (d.kind === 'player'){
        const dir = dirName(player.dir);
        const row = player.dir;
        const col = playerFrame((Math.abs(player.vx)+Math.abs(player.vy))>0.1?'walk':'idle', performance.now()/1000);
        visuals.drawCreature(ctx, {
          creatureId: player.creatureId,
          dir,
          frameCol: col,
          frameRow: row,
          x: player.x - cam.x,
          y: player.y - cam.y,
          scale: 1,
          activeMutations: mutations.active
        });
      }
    }

    // weapon VFX (drawn above actors, below projectiles)
    if (weaponVfx.length){
      for (const wv of weaponVfx){
        const a = clamp(wv.life / Math.max(0.001, wv.life0||0.18), 0, 1);
        const sx = wv.x - cam.x;
        const sy = wv.y - cam.y;
        const ang = Math.atan2(wv.dy||0, wv.dx||1);
        ctx.save();
        ctx.translate(Math.round(sx), Math.round(sy));
        ctx.rotate(ang);
        ctx.imageSmoothingEnabled = false;

        const low = prefs.get(LS.lowVfx,'0') === '1';
        const alpha = low ? (0.55 + a*0.25) : (0.35 + a*0.55);

        if (wv.type === 'CLAMP'){
          const p = 1 - a;
          ctx.fillStyle = `rgba(255,236,170,${alpha})`;
          // two jaws closing
          ctx.fillRect(Math.round(-28 - p*10), -10, 18, 20);
          ctx.fillRect(Math.round(10 + p*10), -10, 18, 20);
          ctx.fillStyle = `rgba(0,0,0,${alpha*0.75})`;
          ctx.fillRect(Math.round(-28 - p*10), -10, 2, 20);
          ctx.fillRect(Math.round(26 + p*10), -10, 2, 20);
        } else if (wv.type === 'BEAR_CLAW'){
          ctx.strokeStyle = `rgba(255,214,138,${alpha})`;
          ctx.lineWidth = 4;
          for (let i=0;i<3;i++){
            const ox = -18 + i*9;
            ctx.beginPath();
            ctx.moveTo(ox, -18);
            ctx.lineTo(ox+10, 18);
            ctx.stroke();
          }
          ctx.lineWidth = 2;
          ctx.strokeStyle = `rgba(0,0,0,${alpha*0.65})`;
          for (let i=0;i<3;i++){
            const ox = -18 + i*9;
            ctx.beginPath();
            ctx.moveTo(ox, -18);
            ctx.lineTo(ox+10, 18);
            ctx.stroke();
          }
        } else if (wv.type === 'STOMP_AURA'){
          const p = 1 - a;
          const r = 34 + p*26;
          ctx.strokeStyle = `rgba(210,240,255,${alpha})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI*2);
          ctx.stroke();
          ctx.strokeStyle = `rgba(0,0,0,${alpha*0.55})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI*2);
          ctx.stroke();
        } else if (wv.type === 'THORN_WHIP'){
          ctx.strokeStyle = `rgba(140,255,170,${alpha})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(84, 0);
          ctx.stroke();
          // thorns
          ctx.fillStyle = `rgba(140,255,170,${alpha})`;
          for (let x=10;x<=78;x+=12){
            ctx.fillRect(x, -5, 3, 3);
          }
          ctx.strokeStyle = `rgba(0,0,0,${alpha*0.65})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(84, 0);
          ctx.stroke();
        } else {
          // Generic signature weapon VFX placeholder
          const k = String(wv.kind||'default').toLowerCase();
          const power = Math.max(1, Number(wv.power||1));
          const isBearClaw = String(wv.type||'').includes('RUMBLEPAW');
          const col = (k.includes('burn')) ? `rgba(255,120,80,${alpha})`
                    : (k.includes('toxin')||k.includes('mire')) ? `rgba(90,255,160,${alpha})`
                    : (k.includes('frost')) ? `rgba(120,210,255,${alpha})`
                    : (k.includes('void')||k.includes('corrupt')||k.includes('echo')) ? `rgba(190,130,255,${alpha})`
                    : `rgba(255,214,138,${alpha})`;
          const p = 1 - a;
          ctx.strokeStyle = col;
          ctx.lineWidth = 3 + Math.min(3, Math.floor(power-1));
          // A wide crescent arc forward (scaled by power)
          const baseR = 62 + p*14 + Math.min(24, (power-1)*10);
          ctx.beginPath();
          ctx.arc(0, 0, baseR, -0.72, 0.72);
          ctx.stroke();
          if (isBearClaw) {
            // Bear claw: add extra stacked arcs + slash sparks at higher power
            const extra = Math.min(3, Math.floor(power));
            for (let j=1;j<=extra;j++){
              ctx.globalAlpha = Math.max(0.15, alpha - j*0.10);
              ctx.beginPath();
              ctx.arc(0, 0, baseR + j*10, -0.78, 0.78);
              ctx.stroke();
            }
            ctx.globalAlpha = alpha;
          }
          // Small spark dots
          ctx.fillStyle = col;
          for (let i=0;i<6;i++){
            const rx = (18 + i*9) * (0.7 + p*0.35);
            const ry = ((i%2)?-10:10) * (0.7 + p*0.35);
            ctx.fillRect(Math.round(rx), Math.round(ry), 2, 2);
          }
        }

        ctx.restore();
      }
    }

    // projectiles (drawn on top of actors)
    const proj = assets.image('core.projectile');
    const _projSpriteCache = window.__wlProjSprites || (window.__wlProjSprites = new Map());
    const getProjSprite = (kind)=>{
      const k = String(kind||'default');
      if (_projSpriteCache.has(k)) return _projSpriteCache.get(k);
      const c = document.createElement('canvas');
      c.width = 16; c.height = 16;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.clearRect(0,0,16,16);
      const palettes = {
        stone: ['#2b1b12','#ffcf6a'],
        wood: ['#16210f','#9fe36a'],
        fiber: ['#0f1f2b','#6ad7ff'],
        default: ['#121212','#ffffff']
      };
      const pal = palettes[k] || (()=>{
        // Stable per-kind palette (no hardcoded list needed for new weapon families)
        let h = 0;
        const s = String(k||'');
        for (let i=0;i<s.length;i++) h = ((h*31) + s.charCodeAt(i))|0;
        const r = (h & 255);
        const g2 = ((h>>8) & 255);
        const b = ((h>>16) & 255);
        const base = `rgb(${(r*0.55+30)|0},${(g2*0.55+30)|0},${(b*0.55+30)|0})`;
        const hi = `rgb(${(r*0.85+80)|0},${(g2*0.85+80)|0},${(b*0.85+80)|0})`;
        return [base, hi];
      })();
      const base = pal[0], hi = pal[1];
      const px = (x,y,w=1,h=1,col=hi)=>{ g.fillStyle=col; g.fillRect(x,y,w,h); };
      // diamond bolt (no circle/square)
      for (let y=0;y<16;y++){
        const dy = Math.abs(7.5 - y);
        const half = Math.max(0, 6 - (dy|0));
        const x0 = 8 - half;
        const w = half*2;
        if (w>0) px(x0, y, w, 1, hi);
      }
      // inner core
      px(7,4,2,8,base);
      px(6,6,4,4,base);
      _projSpriteCache.set(k, c);
      return c;
    };

    for (const p of projectiles) {
      const sx = p.x - cam.x;
      const sy = p.y - cam.y;

      // Trail (decreasing alpha)
      const low = prefs.get(LS.lowVfx,'0') === '1';
      const tr = p.trail || [];
      if (tr.length > 1 && !low) {
        for (let i=0;i<tr.length-1;i++){
          const a = (i+1) / tr.length;
          const x1 = tr[i].x - cam.x, y1 = tr[i].y - cam.y;
          const x2 = tr[i+1].x - cam.x, y2 = tr[i+1].y - cam.y;
          ctx.strokeStyle = (p.owner===0)
            ? (p.kind==='poison' ? `rgba(120,255,160,${0.10 + a*0.22})` : `rgba(255,214,138,${0.10 + a*0.22})`)
            : `rgba(255,216,74,${0.08 + a*0.18})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(Math.round(x1), Math.round(y1));
          ctx.lineTo(Math.round(x2), Math.round(y2));
          ctx.stroke();
        }
      }

      // Unmistakable projectile body (visual size only)
      if (p.owner === 0){
        const sz = (p.kind === 'poison') ? 12 : 10;
        ctx.fillStyle = (p.kind === 'poison') ? 'rgba(120,255,160,0.95)' : 'rgba(255,214,138,0.95)';
        ctx.fillRect(Math.round(sx - sz/2), Math.round(sy - sz/2), sz, sz);
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.lineWidth = 2;
        ctx.strokeRect(Math.round(sx - sz/2), Math.round(sy - sz/2), sz, sz);
        // Glow ring (respect reduced flashes)
        if (prefs.get(LS.reducedFlashes,'1') !== '1'){
          ctx.strokeStyle = (p.kind === 'poison') ? 'rgba(120,255,160,0.55)' : 'rgba(255,214,138,0.55)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy, sz*0.95, 0, Math.PI*2);
          ctx.stroke();
        }
      } else {
        // Player projectile
        // Player projectile (weapon-family tinted sprite)
        const k = (p.kind || 'default');
        const img = getProjSprite(k) || proj;
        if (img) ctx.drawImage(img, Math.round(sx-8), Math.round(sy-8), 16, 16);
        else { ctx.fillStyle = '#ffd84a'; ctx.fillRect(Math.round(sx-5), Math.round(sy-5), 10, 10); }
      }
    }

    if (player2){
      // Draw remote player using the same row/col semantics as local player.
      // (A prior refactor left calls to frameRow/frameCol, which do not exist in this build.)
      const tt = performance.now()/1000;
      const dir2 = (player2.dir == null) ? DIR.DOWN : player2.dir;
      const dir2Name = dirName(dir2);
      const moving2 = ((Math.abs(player2.vx||0) + Math.abs(player2.vy||0)) > 0.1);
      const col2 = playerFrame(moving2 ? 'walk' : 'idle', tt);
      const row2 = dir2;
      visuals.drawCreature(ctx, {
        creatureId: player2.creatureId,
        dir: dir2Name,
        frameCol: col2,
        frameRow: row2,
        x: player2.x - cam.x,
        y: player2.y - cam.y,
        scale: 1,
        activeMutations: mutations.active
      });
    }

    // hit rings
    for (const h of hitRings){
      const denom = (h._life0 || (h._life0 = h.life || 0.25));
      const t = 1 - (h.life / Math.max(0.001, denom));
      const r = h.r0 + t*18;
      const sx = h.x - cam.x;
      const sy = h.y - cam.y;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI*2);
      if (h.fill){
        ctx.fillStyle = h.color || 'rgba(255,214,138,0.22)';
        ctx.fill();
      }
      ctx.strokeStyle = h.color || 'rgba(255,214,138,0.9)';
      ctx.stroke();
    }

    // telegraph lines
    for (const tl of telegraphs){
      const denom = (tl._life0 || (tl._life0 = tl.life || 0.22));
      const a = clamp(tl.life / Math.max(0.001, denom), 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.25 + a*0.75;
      ctx.strokeStyle = tl.color || 'rgba(255,214,138,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(Math.round(tl.x1 - cam.x), Math.round(tl.y1 - cam.y));
      ctx.lineTo(Math.round(tl.x2 - cam.x), Math.round(tl.y2 - cam.y));
      ctx.stroke();
      ctx.restore();
    }


    // floating numbers
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    for (const f of floaters){
      const sx = f.x - cam.x;
      const sy = f.y - cam.y;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const w = ctx.measureText(f.text).width + 6;
      ctx.fillRect(Math.round(sx - w/2), Math.round(sy-7), Math.round(w), 14);
      ctx.fillStyle = f.color || "#fff";
      ctx.fillText(f.text, Math.round(sx - ctx.measureText(f.text).width/2), Math.round(sy));
    }

// end world render
    ctx.restore();

    // restore camera after shake
    cam.x = baseCamX; cam.y = baseCamY;

    // UI / HUD (pixel-locked 640×360 base, composited)
    const hudRects = getHudRects(canvas.width, canvas.height);
    drawHudBase({
      player: (typeof player !== 'undefined') ? player : null,
      bossActive: (typeof boss !== 'undefined' && boss) ? true : false,
      boss: (typeof boss !== 'undefined') ? boss : null,
      runTimeSec: (typeof runTimeSec !== 'undefined') ? runTimeSec : 0,
      xp: (typeof xp !== 'undefined') ? xp : 0,
      xpToNext: (typeof xpToNext !== 'undefined') ? xpToNext : 0,
      level: (typeof level !== 'undefined') ? level : 0,
      activeMutations: (typeof mutations !== 'undefined' && mutations && mutations.active) ? mutations.active : []
    });
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(hudCanvas, hudRects.ox, hudRects.oy, Math.round(640*hudRects.scale), Math.round(360*hudRects.scale));
    ctx.restore();

    diag.render();
  }

  function loop() {
    if (!running) return;
    diag.tickFPS();

    const t = performance.now();
    let dt = (t - lastT) / 1000;
    lastT = t;
    dt = Math.min(0.05, dt);

    // Online CLIENT: do not simulate locally. Send input and render host snapshots.
    if (net.role === 'client'){
      try {
        // Throttle input to ~30hz.
        net._inT = (net._inT || 0) + dt;
        if (net._inT >= (1/30)){
          net._inT = 0;
          netSendToHost(buildInputPacket());
        }
        netClientApplySnapshot();
        draw();
      } catch (err) {
        running = false;
        lastError = _fmtErr(err);
        diag.warn('NET_CLIENT_LOOP_CRASH', { err: String(lastError).slice(0,200) });
      }
      requestAnimationFrame(loop);
      return;
    }

    try {
      if (!pausedForChoice && !gamePaused && !gameOver) {
      acc += dt;
      while (acc >= FIXED_DT) {
        update(FIXED_DT);
        netHostMaybeSendSnapshot(FIXED_DT);
        acc -= FIXED_DT;
      }
    }
    draw();
    } catch (err) {
      running = false;
      lastError = _fmtErr(err);
      diag.warn('RUNTIME_LOOP_CRASH', { err: String(lastError).slice(0,200) });
    }

    requestAnimationFrame(loop);
  }

  // Menu loop (runs even when the game isn't running) to animate the diorama background.
  let menuLast = performance.now();
  function menuLoop(now){
    if (!running) {
      const dt = Math.min(0.05, (now - menuLast) / 1000);
      menuLast = now;

      // Only draw the diorama when we are actually on the main menu.
      // Otherwise (ingame or other screens), draw the normal frame so HUD/errors can be visible.
      if (lastError) {
        try { draw(); } catch(_){}
      } else if (typeof uiScreen !== 'undefined' && uiScreen === 'main') {
        menuScene.update(dt);
        menuScene.draw(ctx);
        diag.tickFPS();
        diag.render();
      } else {
        try { draw(); } catch(_){}
      }
    } else {
      menuLast = now;
    }
    requestAnimationFrame(menuLoop);
  }
  requestAnimationFrame(menuLoop);
})();


})();
