// contentStore.js - deterministic, precompiled runtime content access
export class ContentStore {
  constructor({ loadJSON, diagnostics, assetStore }) {
    this._loadJSON = loadJSON;
    this._diag = diagnostics;
    this._assetStore = assetStore;
    this.content = null;
    this.contentLaunch = null;
    this.contentExperimental = null;
    this._by = { creature: new Map(), stage: new Map(), mutation: new Map(), weaponFamily: new Map(), evolutionNode: new Map() };
  }

  async init() {
    this.content = await this._loadJSON('runtime/content.json');
    this.contentLaunch = await this._loadJSON('runtime/content_launch.json');
    this.contentExperimental = await this._loadJSON('runtime/content_experimental.json');

    for (const c of this.content.creatures) this._by.creature.set(c.id, c);
    for (const s of this.content.stages) this._by.stage.set(s.id, s);
    for (const m of this.content.mutations) this._by.mutation.set(m.id, m);
    for (const w of this.content.weaponFamilies) this._by.weaponFamily.set(w.id, w);

    // Index evolution nodes globally by id for fast lookup.
    const eg = this.content.evolutionGraph || {};
    for (const g of Object.values(eg)) {
      const nodes = g?.nodes || [];
      for (const n of nodes) {
        if (n && n.id) this._by.evolutionNode.set(n.id, n);
      }
    }
    return this;
  }

  creature(id) { return this._by.creature.get(id) || null; }
  stage(id) { return this._by.stage.get(id) || null; }
  mutation(id) { return this._by.mutation.get(id) || null; }
  evolutionNode(id) { return this._by.evolutionNode.get(id) || null; }
  weaponFamily(id) { return this._by.weaponFamily.get(id) || null; }

  listCreatures(showExperimental=false) {
    const launch = this.contentLaunch.creatures.slice().sort((a,b)=>a.displayName.localeCompare(b.displayName));
    if (!showExperimental) return launch;
    const exp = this.contentExperimental.creatures.slice().sort((a,b)=>a.displayName.localeCompare(b.displayName));
    return launch.concat(exp);
  }
  listStages(showExperimental=false) {
    const launch = this.contentLaunch.stages.slice().sort((a,b)=>a.displayName.localeCompare(b.displayName));
    if (!showExperimental) return launch;
    const exp = this.contentExperimental.stages.slice().sort((a,b)=>a.displayName.localeCompare(b.displayName));
    return launch.concat(exp);
  }
  listWeaponFamilies(showExperimental=false) {
    const launch = this.contentLaunch.weaponFamilies.slice().sort((a,b)=>a.displayName.localeCompare(b.displayName));
    if (!showExperimental) return launch;
    const exp = this.contentExperimental.weaponFamilies.slice().sort((a,b)=>a.displayName.localeCompare(b.displayName));
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
