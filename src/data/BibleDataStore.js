// BibleDataStore.js - thin adapter over generated Bible JSON (non-breaking)

function normStr(v) { return (v == null) ? '' : String(v); }

function stableSort(items) {
  // sort by (isLaunch desc, isExperimental asc, sortOrder asc, id asc)
  return items.slice().sort((a, b) => {
    const aL = a?.isLaunch ? 0 : 1;
    const bL = b?.isLaunch ? 0 : 1;
    if (aL !== bL) return aL - bL;
    const aE = a?.isExperimental ? 1 : 0;
    const bE = b?.isExperimental ? 1 : 0;
    if (aE !== bE) return aE - bE;
    const aSO = (a?.sortOrder != null && !Number.isNaN(Number(a.sortOrder))) ? Number(a.sortOrder) : 1e18;
    const bSO = (b?.sortOrder != null && !Number.isNaN(Number(b.sortOrder))) ? Number(b.sortOrder) : 1e18;
    if (aSO !== bSO) return aSO - bSO;
    return normStr(a?.id).localeCompare(normStr(b?.id));
  });
}

export class BibleDataStore {
  constructor({ loadJSON, diagnostics }) {
    this._loadJSON = loadJSON;
    this._diag = diagnostics;
    this._creatures = [];
    this._stages = [];
    this._weapons = [];
    this._props = [];
    this._bosses = [];
    this._ui = null;
  }

  async init() {
    try {
      this._creatures = await this._loadJSON('data/generated/creatures.json');
      this._stages = await this._loadJSON('data/generated/stages.json');
      this._weapons = await this._loadJSON('data/generated/weapons.json');
      this._props = await this._loadJSON('data/generated/props.json');
      this._bosses = await this._loadJSON('data/generated/bosses.json');
      this._ui = await this._loadJSON('data/generated/ui_style_guide.json');
    } catch (e) {
      this._diag?.warn?.('BIBLE_DATA_MISSING', { message: String(e?.message || e) });
      // Leave empty; callers must fall back.
    }
    return this;
  }

  uiStyle() { return this._ui; }

  getLaunchCreatures() { return stableSort(this._creatures.filter(c => !!c.isLaunch)); }
  getExperimentalCreatures() { return stableSort(this._creatures.filter(c => !c.isLaunch)); }
  getLaunchStages() { return stableSort(this._stages.filter(s => !!s.isLaunch)); }
  getExperimentalStages() { return stableSort(this._stages.filter(s => !s.isLaunch)); }
  getLaunchWeapons() { return stableSort(this._weapons.filter(w => !!w.isLaunch)); }
  getExperimentalWeapons() { return stableSort(this._weapons.filter(w => !w.isLaunch)); }

  getEvolutionGraph(creatureId) {
    // Normalized tables are available; the full directed UI is implemented elsewhere.
    // This adapter intentionally returns null if not present.
    return null;
  }

  getWeapon(weaponId) {
    return this._weapons.find(w => w.id === weaponId) || null;
  }

  getPropsForStage(stageId) {
    // If props have stageId field, filter by it; otherwise return empty.
    return this._props.filter(p => p.stageId === stageId);
  }

  getBoss(stageBossId) {
    return this._bosses.find(b => b.id === stageBossId) || null;
  }
}
