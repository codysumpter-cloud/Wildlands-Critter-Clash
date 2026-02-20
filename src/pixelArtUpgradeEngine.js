// pixelArtUpgradeEngine.js
// Runtime, non-destructive pixel upgrade pipeline.
// - Uses ONLY source pixels from the loaded asset image.
// - Produces an upgraded ImageBitmap/Canvas for rendering.
// - Keeps originals intact in memory.
// Notes: This is intentionally conservative to avoid breaking silhouettes/animations.

export class PixelArtUpgradeEngine {
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
