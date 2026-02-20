// assetStore.js - unified registry lookup + preloading (no hardcoded paths in gameplay)
import { PixelArtUpgradeEngine } from './pixelArtUpgradeEngine.js';
export class AssetStore {
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
    this._missingOnce = new Set();
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
    const a = this._assetsById.get(cid);
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
    await Promise.all(unique.map(async (id) => {
      const a = this.get(id);
      if (!a) return;
      if (a.type === 'spritesheet' || a.type === 'image' || a.type === 'icon') {
        await this._loadImageFor(id, a.path);
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
      this._diag?.warn('ASSET_UPGRADE_FAIL', { id: assetId, error: String(e?.message || e) });
    }

    return loaded;
  }

  image(assetId) {
    const cid = this.canonicalId(assetId);
    if (this._upgradeEnabled) {
      return this._upgraded.get(cid) || this._upgraded.get(assetId) || this._images.get(cid) || this._images.get(assetId) || null;
    }
    return this._images.get(cid) || this._images.get(assetId) || null;
  }

  originalImage(assetId) {
    const cid = this.canonicalId(assetId);
    return this._images.get(cid) || this._images.get(assetId) || null;
  }
}
