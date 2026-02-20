// mutationSystem.js - deterministic mutation selection + application
export class MutationSystem {
  constructor({ contentStore, diagnostics }) {
    this._content = contentStore;
    this._diag = diagnostics;
    this.active = []; // mutationIds in deterministic order
    this._seed = 1337;
  }

  reset(seed=1337) {
    this.active.length = 0;
    this._seed = seed|0;
  }

  // deterministic RNG (LCG)
  _rand() {
    this._seed = (1664525 * this._seed + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  add(mutationId) {
    if (!mutationId) return false;
    if (this.active.includes(mutationId)) return false;
    this.active.push(mutationId);
    this.active.sort(); // deterministic stable ordering for replay safety
    return true;
  }

  // draft 3 choices weighted by rarity, deterministic
  draftChoices(count=3) {
    const pool = this._content.content.mutations;
    const weights = { common: 1.0, uncommon: 0.65, rare: 0.35, epic: 0.18, legendary: 0.08 };
    const avail = pool.filter(m => !this.active.includes(m.id));
    const picked = [];
    for (let i=0;i<count && avail.length;i++) {
      const total = avail.reduce((s,m)=>s+(weights[m.rarity]||0.4),0);
      let r = this._rand() * total;
      let idx = 0;
      for (; idx<avail.length; idx++) {
        r -= (weights[avail[idx].rarity]||0.4);
        if (r <= 0) break;
      }
      const m = avail.splice(Math.min(idx, avail.length-1),1)[0];
      picked.push(m.id);
    }
    return picked;
  }
}
