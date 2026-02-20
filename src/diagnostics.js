// diagnostics.js - overlay + structured warnings
export class Diagnostics {
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
    el.style.color = 'var(--wl-text)';
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
