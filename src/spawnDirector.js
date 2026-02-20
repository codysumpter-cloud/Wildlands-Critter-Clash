// spawnDirector.js - launch scope enforcement + enemy sprite selection via registry
export class SpawnDirector {
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
