// game.js (module) - deterministic, data-driven mutation arena prototype (refactored)
import { Diagnostics } from './src/diagnostics.js';
import { AssetStore } from './src/assetStore.js';
import { ContentStore } from './src/contentStore.js';
import { VisualAssembler } from './src/visualAssembler.js';
import { MutationSystem } from './src/mutationSystem.js';
import { SpawnDirector } from './src/spawnDirector.js';

(async () => {
  'use strict';

  // --- DOM ---
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const elOverlay = document.getElementById('overlay');
  const elChoices = document.getElementById('choices');
  const elOverlayTitle = document.getElementById('overlayTitle');
  const elOverlaySub = document.getElementById('overlaySub');

  const elStart = document.getElementById('start');
  const elCreatureList = document.getElementById('creatureList');
  const elStageList = document.getElementById('stageList');
  const elWeaponList = document.getElementById('weaponList');
  const elToggleExp = document.getElementById('toggleExperimental');
  const elTogglePixel = document.getElementById('togglePixelUpgrade');
  const elBtnStart = document.getElementById('btnStartRun');

  const diag = new Diagnostics();

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

  // --- Theme tokens (Bible-driven) ---
  try {
    const ui = await loadJSON('runtime/ui_style_guide.json');
    const colors = (ui && ui.colors) || {};
    const map = {
      Background: '--wl-bg',
      PanelBase: '--wl-panel',
      PanelDark: '--wl-panel-dark',
      BorderPrimary: '--wl-border',
      BorderHighlight: '--wl-border-hi',
      Accent_Action: '--wl-accent',
      Secondary: '--wl-secondary',
      Danger: '--wl-danger',
      PvP: '--wl-pvp'
    };
    for (const [k, cssVar] of Object.entries(map)) {
      if (colors[k]) document.documentElement.style.setProperty(cssVar, String(colors[k]));
    }
  } catch (_) {
    // Optional; fall back to defaults in wildlands_theme.css
  }

  // HUD layout (Bible-driven) + dev overlay toggle (F2)
  let hudLayout = null;
  let hudDebug = false;
  try { hudLayout = await loadJSON('runtime/hud_layout.json'); } catch (_) {}

  // --- Stores ---
  const assets = await new AssetStore({ loadJSON, diagnostics: diag }).init();
  // Pixel Upgrade Engine toggle (Bible-driven via asset tags)
  if (elTogglePixel) {
    assets.setUpgradeEnabled(!!elTogglePixel.checked);
    elTogglePixel.addEventListener('change', () => {
      assets.setUpgradeEnabled(!!elTogglePixel.checked);
      // Hard refresh is the simplest way to ensure preloaded assets re-upgrade deterministically.
      // This preserves originals in memory only for the current session.
      location.reload();
    });
  }
  const content = await new ContentStore({ loadJSON, diagnostics: diag, assetStore: assets }).init();
  const visuals = await new VisualAssembler({ assetStore: assets, contentStore: content, diagnostics: diag, loadJSON }).init();
  const mutations = new MutationSystem({ contentStore: content, diagnostics: diag });
  const spawns = new SpawnDirector({ contentStore: content, assetStore: assets, diagnostics: diag });
  spawns.initEnemyCatalog();

  // --- Preload (launch) ---
  await assets.preloadLaunch();

  // --- Input ---
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false };

  // Camera zoom (zoom < 1 = zoom out). Wheel or +/- to adjust.
  let zoom = 1.0;
  function setZoom(z) { zoom = clamp(z, 0.5, 2.0); }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (e.key === ' ') e.preventDefault();
    if (k === 'escape') {
      if (!elOverlay.classList.contains('hidden')) hideOverlay();
    }
    if (k === 'r') restartRun();
    // Debug: spawn/clear boss for parity smoke-test
    if (k === 'b') toggleBoss();
    if (k === 'f2') hudDebug = !hudDebug;
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

  // Zoom with mouse wheel (desktop).
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    if (dir > 0) setZoom(zoom / 1.12);
    else if (dir < 0) setZoom(zoom * 1.12);
  }, { passive: false });
  canvas.addEventListener('mousedown', () => (mouse.down = true));
  window.addEventListener('mouseup', () => (mouse.down = false));

  // --- Helpers ---
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function norm(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

  function takeDamage(amount, kind='hit') {
    if (!player || amount <= 0) return;
    ensurePlayerState(player);
    if (player.invuln > 0) return;
    player.hp = Math.max(0, player.hp - Math.round(amount));
    player.invuln = 0.25; // brief i-frames; avoids multi-hit spam
    vfxBurst(player.x, player.y, kind, 12);
    SFX.hit();
  }

  // --- Menu ---
  let menuSel = { creatureId: null, stageId: null, weaponFamilyId: null, showExperimental: false };

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
    const iconAsset = iconAssetId ? assets.get(iconAssetId) : null;
    if (iconAsset?.path) {
      img.src = iconAsset.path;
      // Fire-and-forget preload so in-game draws can use cached HTMLImageElement.
      assets.preloadAssetIds([iconAssetId]).catch(()=>{});
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
    if (menuSel.weaponFamilyId && !weaponFamilies.some(w => w.id === menuSel.weaponFamilyId)) menuSel.weaponFamilyId = null;

    if (!menuSel.creatureId && creatures.length) menuSel.creatureId = creatures[0].id;
    if (!menuSel.stageId && stages.length) menuSel.stageId = stages[0].id;
    if (!menuSel.weaponFamilyId && weaponFamilies.length) menuSel.weaponFamilyId = weaponFamilies[0].id;

    // creatures
    elCreatureList.innerHTML = '';
    for (const c of creatures) {
      const iconId = assets.creatureIconAssetId(c.id);
      const card = makeCard({
        title: c.displayName,
        subtitle: (c.isExperimental ? 'Experimental' : 'Launch'),
        iconAssetId: iconId,
        isExperimental: !!c.isExperimental,
        onClick: () => { menuSel.creatureId = c.id; refreshMenu(); }
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
        iconAssetId: 'core.grass', // stage icon not yet authored; deterministic fallback via registry
        isExperimental: !!s.isExperimental,
        onClick: () => { menuSel.stageId = s.id; refreshMenu(); }
      });
      if (menuSel.stageId === s.id) card.classList.add('selected');
      elStageList.appendChild(card);
    }

    // weapon families
    elWeaponList.innerHTML = '';
    for (const w of weaponFamilies) {
      const iconId = `weaponFamily.${w.icon || ('family_' + w.id.toLowerCase())}.icon`;
      const card = makeCard({
        title: w.displayName || w.id,
        subtitle: (w.isExperimental ? 'Experimental' : 'Launch'),
        iconAssetId: iconId,
        isExperimental: !!w.isExperimental,
        onClick: () => { menuSel.weaponFamilyId = w.id; refreshMenu(); }
      });
      if (menuSel.weaponFamilyId === w.id) card.classList.add('selected');
      elWeaponList.appendChild(card);
    }

    const ready = !!(menuSel.creatureId && menuSel.stageId && menuSel.weaponFamilyId);
    elBtnStart.disabled = !ready;
  }

  elToggleExp.addEventListener('change', refreshMenu);
  elBtnStart.addEventListener('click', () => startRun());
  refreshMenu();

  // --- Game state (deterministic) ---
  const world = { w: 2600, h: 2600 };
  const cam = { x: 0, y: 0 };

  // Debug boss entity (prototype parity)
  let boss = null; // {x,y,hp,r,speed,sheetId,t,scale}

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

  let running = false;
  let pausedForChoice = false;

  let player = null;
  let enemies = [];
  let projectiles = [];
  let xp = 0, level = 1, xpToNext = 10;

  let seed = 1337;
  function reseed() { seed = (seed * 1103515245 + 12345) >>> 0; return seed; }
  function frand() { return (reseed() / 4294967296); }

  function startRun() {
    const enforced = spawns.enforceLaunchScope({ ...menuSel }, menuSel.showExperimental);
    menuSel = { ...menuSel, ...enforced };

    elStart.classList.add('hidden');
    running = true;
    restartRun();
    requestAnimationFrame(loop);
  }

  function restartRun() {
    if (!running) return;

    const creatureId = menuSel.creatureId;
    const c = content.creature(creatureId);
    if (!c) return;

    seed = 1337;
    mutations.reset(1337);

    player = {
      creatureId,
      x: world.w/2, y: world.h/2,
      vx: 0, vy: 0,
      dir: DIR.DOWN,
      hp: c.baseMaxHp || 120,
      maxHp: c.baseMaxHp || 120,
      r: 22,
      moveSpeed: c.baseMoveSpeed || 4.0,
      fireCadence: (c.autoAttackSpec?.cadence) || 0.8,
      range: (c.autoAttackSpec?.range) || 6.0,
      damage: (c.autoAttackSpec?.damage) || 4.0,
      lastShot: 0,
      invuln: 0,
      slowT: 0,
      poisonT: 0,
      poisonDps: 0,
    };
    enemies = [];
    projectiles = [];
    enemyProjectiles = [];
    particles = [];
    puddles = [];
    xp = 0; level = 1; xpToNext = 10;
    pausedForChoice = false;
    elOverlay.classList.add('hidden');
  }

  function applyMutationEffects(mutId) {
    const m = content.mutation(mutId);
    if (!m) return;
    for (const eff of (m.effects || [])) {
      if (eff.type === 'projectile_mod') {
        if (eff.bonusDamage) player.damage *= (1 + eff.bonusDamage);
        if (eff.bonusRange) player.range *= (1 + eff.bonusRange);
        if (eff.bonusCadence) player.fireCadence *= (1 - eff.bonusCadence);
      }
      if (eff.type === 'hp_mod') {
        if (eff.bonusMaxHp) {
          player.maxHp = Math.round(player.maxHp * (1 + eff.bonusMaxHp));
          player.hp = Math.min(player.hp + Math.round(player.maxHp * 0.2), player.maxHp);
        }
      }
    }
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
    const choices = mutations.draftChoices(3);
    elOverlayTitle.textContent = 'Choose Mutation';
    elOverlaySub.textContent = `Level ${level} — pick 1`;
    elChoices.innerHTML = '';
    elOverlay.classList.remove('hidden');

    const cards = choices.map((id, idx) => {
      const m = content.mutation(id);
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `<div style="font-weight:700">${idx+1}. ${m?.name || id}</div><div style="opacity:0.85;font-size:12px">${m?.description || ''}</div>`;
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
    window.onkeydown = null;
  }

  function pickMutation(id) {
    if (!id) return;
    mutations.add(id);
    applyMutationEffects(id);
    hideOverlay();
  }

  // --- Simulation ---
  const FIXED_DT = 1/60;
  let acc = 0;
  let lastT = performance.now();

  // --- Minimal SFX (no external assets; WebAudio) ---
  const SFX = (() => {
    let ctxA = null;
    function ensure() {
      if (ctxA) return ctxA;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctxA = new AC();
      return ctxA;
    }
    function beep(freq=440, dur=0.06, type='square', vol=0.06) {
      const ac = ensure();
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume().catch(()=>{});
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g);
      g.connect(ac.destination);
      const t0 = ac.currentTime;
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.start(t0);
      o.stop(t0 + dur);
    }
    return {
      hit: () => beep(180, 0.05, 'square', 0.07),
      shoot: () => beep(760, 0.03, 'square', 0.05),
      spit: () => beep(520, 0.05, 'sawtooth', 0.04),
      boom: () => beep(90, 0.09, 'triangle', 0.09),
      dash: () => beep(240, 0.05, 'square', 0.05),
    };
  })();

  // --- VFX (simple particles / puddles; no external assets) ---
  let particles = []; // {x,y,vx,vy,life,size,kind}
  let puddles = [];   // {x,y,r,life,kind}
  function vfxBurst(x, y, kind='hit', count=10) {
    for (let i=0;i<count;i++) {
      const a = frand() * Math.PI * 2;
      const sp = 40 + frand()*120;
      particles.push({
        x, y,
        vx: Math.cos(a)*sp,
        vy: Math.sin(a)*sp,
        life: 0.22 + frand()*0.18,
        size: 2 + (frand()*3|0),
        kind
      });
    }
  }
  function vfxPuddle(x, y, kind='poison', r=22, life=2.8) {
    puddles.push({ x, y, r, life, kind });
  }

  // --- Enemy variants (deterministic) ---
  const ENEMY_ARCH = {
    MELEE: 'melee',
    CHARGER: 'charger',
    RANGED: 'ranged',
    SPITTER: 'spitter',
    BOMBER: 'bomber',
  };
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i=0;i<s.length;i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function pickArchetype(spriteId) {
    const h = hashStr(String(spriteId||''));
    const r = h % 5;
    return [ENEMY_ARCH.MELEE, ENEMY_ARCH.CHARGER, ENEMY_ARCH.RANGED, ENEMY_ARCH.SPITTER, ENEMY_ARCH.BOMBER][r];
  }

  // --- Enemy projectiles ---
  let enemyProjectiles = []; // {x,y,vx,vy,life,dmg,kind,r}

  // --- Player status ---
  function ensurePlayerState(p) {
    if (!p) return;
    if (!p.r) p.r = 22;
    if (!p.invuln) p.invuln = 0;
    if (!p.slowT) p.slowT = 0;
    if (!p.poisonT) p.poisonT = 0;
    if (!p.poisonDps) p.poisonDps = 0;
  }

  function spawnWave(dt) {
    // simple deterministic spawn rate scaled by level
    const rate = 0.6 + Math.min(2.0, level*0.08);
    if (frand() < rate * dt) {
      const ang = frand() * Math.PI * 2;
      const r = 420 + frand()*260;
      const ex = clamp(player.x + Math.cos(ang)*r, 40, world.w-40);
      const ey = clamp(player.y + Math.sin(ang)*r, 40, world.h-40);
      const spriteId = spawns.pickEnemySpriteId();
      const arch = pickArchetype(spriteId);
      // Distinct feel via speed + attack cadence; deterministic per spawn.
      const baseHp = 10 + level*2;
      const hpMul = arch === ENEMY_ARCH.CHARGER ? 1.15 : arch === ENEMY_ARCH.BOMBER ? 0.9 : 1.0;
      const baseSpeed = 1.05 + level*0.018;
      const spMul = arch === ENEMY_ARCH.RANGED ? 0.95 : arch === ENEMY_ARCH.SPITTER ? 0.9 : arch === ENEMY_ARCH.CHARGER ? 1.25 : arch === ENEMY_ARCH.BOMBER ? 0.85 : 1.05;
      enemies.push({
        x: ex, y: ey,
        hp: Math.round(baseHp * hpMul),
        r: 22,
        speed: baseSpeed * spMul,
        spriteId,
        t: 0,
        arch,
        atkCd: 0,
        stateT: 0,
        dashT: 0,
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
      r: 64,
      speed: 0.65,
      sheetId,
      t: 0,
      scale: 2.1
    };
  }

  function update(dt) {
    if (!player) return;
    diag.clearFrame();

    ensurePlayerState(player);
    // status timers
    player.invuln = Math.max(0, player.invuln - dt);
    player.slowT = Math.max(0, player.slowT - dt);
    player.poisonT = Math.max(0, player.poisonT - dt);
    if (player.poisonT > 0 && player.poisonDps > 0) {
      // poison is steady DoT; no i-frames
      player.hp = Math.max(0, player.hp - player.poisonDps * dt);
      if (frand() < 8*dt) particles.push({ x: player.x + (frand()*10-5), y: player.y + (frand()*10-5), vx: 0, vy: -10, life: 0.18, size: 2, kind: 'poison' });
    } else if (player.poisonT <= 0) {
      player.poisonDps = 0;
    }

    // input movement
    let mx = 0, my = 0;
    if (keys.has('w') || keys.has('arrowup')) my -= 1;
    if (keys.has('s') || keys.has('arrowdown')) my += 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    const [nx, ny] = norm(mx, my);
    const slowMul = player.slowT > 0 ? 0.65 : 1.0;
    player.vx = nx * player.moveSpeed * slowMul * 60 * dt;
    player.vy = ny * player.moveSpeed * slowMul * 60 * dt;
    player.x = clamp(player.x + player.vx, 30, world.w-30);
    player.y = clamp(player.y + player.vy, 30, world.h-30);
    player.dir = getMoveDir(player.vx, player.vy, player.dir);

    // shooting
    const t = performance.now()/1000;
    if (mouse.down && (t - player.lastShot) >= player.fireCadence) {
      player.lastShot = t;
      const dx = (mouse.x/zoom + cam.x) - player.x;
      const dy = (mouse.y/zoom + cam.y) - player.y;
      const [sx, sy] = norm(dx, dy);
      projectiles.push({
        x: player.x, y: player.y,
        vx: sx * 520,
        vy: sy * 520,
        life: player.range * 140,
        dmg: player.damage
      });
    }

    // enemies (variants)
    spawnWave(dt);
    for (const e of enemies) {
      e.t += dt;
      e.atkCd = Math.max(0, (e.atkCd||0) - dt);
      e.stateT = (e.stateT||0) + dt;

      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const [sx, sy] = [dx/dist, dy/dist];

      // Default steering
      let mvx = sx * e.speed * 90 * dt;
      let mvy = sy * e.speed * 90 * dt;

      if (e.arch === ENEMY_ARCH.RANGED) {
        // Keep mid-range; strafe slightly for variation
        const target = 220;
        if (dist < target*0.85) { mvx = -sx * e.speed * 95 * dt; mvy = -sy * e.speed * 95 * dt; }
        if (dist > target*1.15) { mvx = sx * e.speed * 95 * dt; mvy = sy * e.speed * 95 * dt; }
        const str = ((hashStr(String(e.spriteId)) & 1) ? 1 : -1);
        mvx += (-sy) * str * 28 * dt;
        mvy += ( sx) * str * 28 * dt;
        // Shoot
        if (e.atkCd <= 0 && dist < 520) {
          e.atkCd = 1.15 + frand()*0.35;
          enemyProjectiles.push({ x: e.x, y: e.y, vx: sx*260, vy: sy*260, life: 1.9, dmg: 6 + level*0.25, kind: 'bolt', r: 6 });
          vfxBurst(e.x, e.y, 'shoot', 6);
          SFX.shoot();
        }
      } else if (e.arch === ENEMY_ARCH.SPITTER) {
        // Slow approach; lob spit that leaves a poison puddle
        mvx = sx * e.speed * 75 * dt;
        mvy = sy * e.speed * 75 * dt;
        if (e.atkCd <= 0 && dist < 560) {
          e.atkCd = 1.6 + frand()*0.55;
          enemyProjectiles.push({ x: e.x, y: e.y, vx: sx*190, vy: sy*190, life: 2.4, dmg: 3 + level*0.12, kind: 'spit', r: 7 });
          vfxBurst(e.x, e.y, 'poison', 6);
          SFX.spit();
        }
      } else if (e.arch === ENEMY_ARCH.BOMBER) {
        // Loiter and throw a slow bomb that explodes (AoE + slow)
        const target = 260;
        if (dist < target) { mvx = -sx * e.speed * 70 * dt; mvy = -sy * e.speed * 70 * dt; }
        else { mvx = sx * e.speed * 70 * dt; mvy = sy * e.speed * 70 * dt; }
        // slight orbit
        mvx += (-sy) * 34 * dt;
        mvy += ( sx) * 34 * dt;
        if (e.atkCd <= 0 && dist < 640) {
          e.atkCd = 2.2 + frand()*0.8;
          enemyProjectiles.push({ x: e.x, y: e.y, vx: sx*160, vy: sy*160, life: 2.6, dmg: 0, kind: 'bomb', r: 8, explodeR: 58 });
          vfxBurst(e.x, e.y, 'shoot', 7);
          SFX.shoot();
        }
      } else if (e.arch === ENEMY_ARCH.CHARGER) {
        // Short dash windows; otherwise wander-chase
        if ((e.dashT||0) > 0) {
          e.dashT -= dt;
          mvx = sx * 420 * dt;
          mvy = sy * 420 * dt;
          if (frand() < 12*dt) particles.push({ x: e.x, y: e.y, vx: -sx*40, vy: -sy*40, life: 0.12, size: 2, kind: 'dash' });
        } else {
          // windup: if close-ish and off cooldown, dash
          if (e.atkCd <= 0 && dist < 340) {
            e.atkCd = 2.0 + frand()*0.6;
            e.dashT = 0.22;
            vfxBurst(e.x, e.y, 'dash', 10);
            SFX.dash();
          }
        }
      } else {
        // MELEE baseline: direct chase with small jitter
        mvx += (frand()*2-1) * 10 * dt;
        mvy += (frand()*2-1) * 10 * dt;
      }

      e.x = clamp(e.x + mvx, 30, world.w-30);
      e.y = clamp(e.y + mvy, 30, world.h-30);
    }

    // boss (debug parity)
    if (boss) {
      boss.t += dt;
      const dx = player.x - boss.x;
      const dy = player.y - boss.y;
      const [sx, sy] = norm(dx, dy);
      boss.x += sx * boss.speed * 90 * dt;
      boss.y += sy * boss.speed * 90 * dt;
    }

    // player projectiles
    for (const p of projectiles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= Math.hypot(p.vx, p.vy) * dt;
    }
    projectiles = projectiles.filter(p => p.life > 0);

    // enemy projectiles
    for (const p of enemyProjectiles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.kind === 'bomb' && p.life <= 0) {
        const R = p.explodeR || 58;
        vfxBurst(p.x, p.y, 'boom', 18);
        SFX.boom();
        const dd = Math.hypot(player.x - p.x, player.y - p.y);
        if (dd < R) {
          takeDamage(10 + level*0.3, 'boom');
          player.slowT = Math.max(player.slowT, 1.1);
        }
      }
    }
    enemyProjectiles = enemyProjectiles.filter(p => p.life > 0);

    // puddles & particles
    for (const q of puddles) q.life -= dt;
    puddles = puddles.filter(q => q.life > 0);
    for (const fx of particles) {
      fx.x += fx.vx * dt;
      fx.y += fx.vy * dt;
      fx.life -= dt;
      fx.vx *= Math.pow(0.08, dt);
      fx.vy *= Math.pow(0.08, dt);
    }
    particles = particles.filter(fx => fx.life > 0);

    // collisions (deterministic order)
    enemies.sort((a,b)=> (a.x-b.x) || (a.y-b.y));
    for (const p of projectiles) {
      for (const e of enemies) {
        const dx = e.x - p.x, dy = e.y - p.y;
        if (dx*dx + dy*dy <= (e.r*e.r)) {
          e.hp -= p.dmg;
          p.life = 0;
          break;
        }
      }
      if (boss) {
        const dx = boss.x - p.x, dy = boss.y - p.y;
        if (dx*dx + dy*dy <= (boss.r*boss.r)) {
          boss.hp -= p.dmg;
          p.life = 0;
        }
      }
    }
    projectiles = projectiles.filter(p => p.life > 0);

    // enemy projectiles -> player
    for (const p of enemyProjectiles) {
      const dx = player.x - p.x, dy = player.y - p.y;
      const rr = (p.r||6) + player.r;
      if (dx*dx + dy*dy <= rr*rr) {
        if (p.kind === 'bolt') {
          takeDamage(p.dmg, 'hit');
        } else if (p.kind === 'spit') {
          // low direct dmg + poison puddle
          if (player.invuln <= 0) takeDamage(p.dmg, 'poison');
          vfxPuddle(p.x, p.y, 'poison', 26, 2.9);
        } else if (p.kind === 'bomb') {
          // immediate explode on contact
          const R = p.explodeR || 58;
          vfxBurst(p.x, p.y, 'boom', 18);
          SFX.boom();
          // apply AoE if within
          const dd = Math.hypot(player.x - p.x, player.y - p.y);
          if (dd < R) {
            takeDamage(10 + level*0.3, 'boom');
            player.slowT = Math.max(player.slowT, 1.1);
          }
        }
        p.life = 0;
      }
    }
    enemyProjectiles = enemyProjectiles.filter(p => p.life > 0);

    // puddles damage / slow
    for (const q of puddles) {
      const dd = Math.hypot(player.x - q.x, player.y - q.y);
      if (dd < q.r + player.r*0.3) {
        if (q.kind === 'poison') {
          player.poisonT = Math.max(player.poisonT, 1.5);
          player.poisonDps = Math.max(player.poisonDps, 3.0 + level*0.15);
        }
      }
    }

    // soft collision (friction) + melee contact damage (no impact damage)
    let overlapCount = 0;
    for (const e of enemies) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const rr = (player.r + e.r);
      const d2 = dx*dx + dy*dy;
      if (d2 <= rr*rr) {
        overlapCount++;
        // melee touch tick w/ per-enemy cooldown
        if ((e.touchCd||0) <= 0) {
          e.touchCd = 0.55;
          // baseline touch damage (already exists conceptually)
          const dmg = e.arch === ENEMY_ARCH.CHARGER ? (9 + level*0.25) : e.arch === ENEMY_ARCH.BOMBER ? (6 + level*0.2) : (7 + level*0.22);
          takeDamage(dmg, 'hit');
          // special on-touch effects
          if (e.arch === ENEMY_ARCH.SPITTER) {
            player.poisonT = Math.max(player.poisonT, 1.0);
            player.poisonDps = Math.max(player.poisonDps, 2.8 + level*0.12);
          }
          if (e.arch === ENEMY_ARCH.BOMBER) {
            player.slowT = Math.max(player.slowT, 0.7);
          }
        }
      }
      e.touchCd = Math.max(0, (e.touchCd||0) - dt);
    }
    if (overlapCount > 0) {
      const fric = clamp(0.18 * overlapCount, 0.18, 0.62);
      // Apply resistance by rewinding a portion of movement this tick.
      player.x = clamp(player.x - player.vx * fric, 30, world.w-30);
      player.y = clamp(player.y - player.vy * fric, 30, world.h-30);
    }

    // remove dead
    const alive = [];
    for (const e of enemies) {
      if (e.hp <= 0) grantXP(3);
      else alive.push(e);
    }
    enemies = alive;

    if (boss && boss.hp <= 0) {
      boss = null;
      grantXP(50);
    }

    // camera (zoom-aware)
    const viewW = canvas.width / zoom;
    const viewH = canvas.height / zoom;
    cam.x = player.x - viewW/2;
    cam.y = player.y - viewH/2;
    cam.x = clamp(cam.x, 0, world.w - viewW);
    cam.y = clamp(cam.y, 0, world.h - viewH);

    diag.state.entities = 1 + enemies.length + projectiles.length;
    if (boss) diag.state.entities += 1;
    diag.state.activeMutations = mutations.active.slice();
  }

  function draw() {
    if (!player) return;

    // background
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const viewW = canvas.width / zoom;
    const viewH = canvas.height / zoom;

    // World render (scaled). HUD draws after restore().
    ctx.save();
    ctx.scale(zoom, zoom);

    const grass = assets.image('core.grass');
    if (grass) {
      const tw = 64, th = 64;
      for (let y = -((cam.y|0)%th); y < viewH; y += th) {
        for (let x = -((cam.x|0)%tw); x < viewW; x += tw) {
          ctx.drawImage(grass, x, y, tw, th);
        }
      }
    }

    // puddles (hazards)
    for (const q of puddles) {
      const sx = q.x - cam.x;
      const sy = q.y - cam.y;
      if (q.kind === 'poison') {
        ctx.fillStyle = 'rgba(90, 210, 120, 0.22)';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
      }
      ctx.beginPath();
      ctx.arc(sx, sy, q.r, 0, Math.PI*2);
      ctx.fill();
    }

    // projectiles
    const proj = assets.image('core.projectile');
    for (const p of projectiles) {
      const sx = p.x - cam.x;
      const sy = p.y - cam.y;
      if (proj) ctx.drawImage(proj, Math.round(sx-4), Math.round(sy-4), 8, 8);
      else { ctx.fillStyle = 'rgba(227,168,58,0.95)'; ctx.fillRect(Math.round(sx-2), Math.round(sy-2), 4, 4); }
    }

    // enemy projectiles
    for (const p of enemyProjectiles) {
      const sx = p.x - cam.x;
      const sy = p.y - cam.y;
      if (p.kind === 'bolt') {
        ctx.fillStyle = 'rgba(255, 120, 120, 0.95)';
        ctx.fillRect(Math.round(sx-3), Math.round(sy-3), 6, 6);
      } else if (p.kind === 'spit') {
        ctx.fillStyle = 'rgba(120, 240, 160, 0.9)';
        ctx.fillRect(Math.round(sx-4), Math.round(sy-4), 8, 8);
      } else if (p.kind === 'bomb') {
        ctx.fillStyle = 'rgba(240, 210, 120, 0.95)';
        ctx.fillRect(Math.round(sx-4), Math.round(sy-4), 8, 8);
      }
    }

    // particles
    for (const fx of particles) {
      const sx = fx.x - cam.x;
      const sy = fx.y - cam.y;
      if (fx.kind === 'poison') ctx.fillStyle = 'rgba(120,240,160,0.9)';
      else if (fx.kind === 'boom') ctx.fillStyle = 'rgba(240,210,120,0.9)';
      else if (fx.kind === 'dash') ctx.fillStyle = 'rgba(220,220,255,0.75)';
      else if (fx.kind === 'shoot') ctx.fillStyle = 'rgba(255,180,120,0.85)';
      else ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(Math.round(sx), Math.round(sy), fx.size, fx.size);
    }

    // enemies
    for (const e of enemies) {
      const sx = e.x - cam.x;
      const sy = e.y - cam.y;
      const sheetId = e.spriteId ? assets.enemySheetAssetId(e.spriteId) : null;
      const sheet = sheetId ? assets.image(sheetId) : null;
      const meta = sheetId ? assets.get(sheetId)?.meta : null;
      if (sheet && meta) {
        const cellW = meta.cellW, cellH = meta.cellH;
        const col = ((e.t*6)|0) % Math.max(1, meta.cols||6);
        const row = 0;
        ctx.drawImage(sheet, col*cellW, row*cellH, cellW, cellH, Math.round(sx-32), Math.round(sy-32), 64, 64);
      } else {
        ctx.fillStyle = 'rgba(212,71,71,0.9)';
        ctx.fillRect(Math.round(sx-10), Math.round(sy-10), 20, 20);
      }
    }

    // boss (debug parity)
    if (boss) {
      const sx = boss.x - cam.x;
      const sy = boss.y - cam.y;
      const sheet = assets.image(boss.sheetId);
      const meta = assets.get(boss.sheetId)?.meta;
      if (sheet && meta) {
        const cellW = meta.cellW, cellH = meta.cellH;
        const col = ((boss.t*8)|0) % Math.max(1, meta.cols||8);
        const row = ((boss.t*2)|0) % Math.max(1, meta.rows||10);
        const dw = Math.round(cellW * boss.scale);
        const dh = Math.round(cellH * boss.scale);
        ctx.drawImage(sheet, col*cellW, row*cellH, cellW, cellH, Math.round(sx - dw/2), Math.round(sy - dh/2), dw, dh);
      } else {
        ctx.fillStyle = 'rgba(176,76,225,0.95)';
        ctx.fillRect(Math.round(sx-40), Math.round(sy-40), 80, 80);
      }
    }

    // player (base + attachments)
    const dir = dirName(player.dir);
    const row = player.dir; // DOWN/UP/RIGHT/LEFT -> row
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

    // end world render
    ctx.restore();

    // UI / HUD (pixel-locked to 640x360 base with uniform scale)
    const baseW = (hudLayout && hudLayout.base && hudLayout.base.w) ? hudLayout.base.w : 640;
    const baseH = (hudLayout && hudLayout.base && hudLayout.base.h) ? hudLayout.base.h : 360;
    const uiScale = Math.min(canvas.width / baseW, canvas.height / baseH);
    const hpBox = (hudLayout && hudLayout.boxes && hudLayout.boxes.hp && typeof hudLayout.boxes.hp.x === 'number')
      ? hudLayout.boxes.hp
      : { x: 16, y: 16, w: 180, h: 20 };
    const hudX = Math.round(hpBox.x * uiScale);
    const hudY = Math.round(hpBox.y * uiScale);
    const hudW = Math.round(360 * uiScale);
    const hudH = Math.round(118 * uiScale);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(hudX, hudY, hudW, hudH);

    ctx.fillStyle = 'rgba(242,238,238,0.98)';
    ctx.font = `${Math.round(12 * uiScale)}px monospace`;

    // Health bar
    const hp = Math.max(0, player.hp|0);
    const mhp = Math.max(1, player.maxHp|0);
    const hpPct = Math.max(0, Math.min(1, hp / mhp));
    ctx.fillText(`HP: ${hp}/${mhp}`, hudX + Math.round(8*uiScale), hudY + Math.round(18*uiScale));
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(hudX + Math.round(8*uiScale), hudY + Math.round(24*uiScale), hudW - Math.round(16*uiScale), Math.round(10*uiScale));
    ctx.fillStyle = 'rgba(120,240,120,0.85)';
    ctx.fillRect(hudX + Math.round(8*uiScale), hudY + Math.round(24*uiScale), Math.round((hudW - Math.round(16*uiScale)) * hpPct), Math.round(10*uiScale));

    // Level / XP
    ctx.fillStyle = 'rgba(242,238,238,0.98)';
    ctx.fillText(`Level: ${level}  XP: ${xp}/${xpToNext}`, hudX + Math.round(8*uiScale), hudY + Math.round(52*uiScale));

    // Zoom hint
    ctx.fillStyle = 'rgba(242,238,238,0.85)';
    ctx.fillText(`Zoom: ${zoom.toFixed(2)}x  (wheel / +/- , 0 reset)`, hudX + Math.round(8*uiScale), hudY + Math.round(70*uiScale));

    // Active upgrades (most recent first)
    const names = (mutations.active || []).slice().reverse().map(id => (content.mutation(id)?.name || id));
    const shown = names.slice(0, 6);
    ctx.fillStyle = 'rgba(242,238,238,0.98)';
    ctx.fillText(`Upgrades: ${mutations.active.length}`, hudX + Math.round(8*uiScale), hudY + Math.round(88*uiScale));
    ctx.fillStyle = 'rgba(242,238,238,0.85)';
    ctx.fillText(shown.join(', ') || '—', hudX + Math.round(8*uiScale), hudY + Math.round(106*uiScale));

    if (hudDebug && hudLayout && hudLayout.boxes) {
      ctx.save();
      ctx.strokeStyle = 'rgba(227,168,58,0.85)';
      ctx.lineWidth = 1;
      for (const b of Object.values(hudLayout.boxes)) {
        if (!b || typeof b.x !== 'number') continue;
        ctx.strokeRect(Math.round(b.x*uiScale), Math.round(b.y*uiScale), Math.round((b.w||0)*uiScale), Math.round((b.h||0)*uiScale));
      }
      ctx.restore();
    }

    diag.render();
  }

  function loop() {
    if (!running) return;
    diag.tickFPS();

    const t = performance.now();
    let dt = (t - lastT) / 1000;
    lastT = t;
    dt = Math.min(0.05, dt);
    if (!pausedForChoice) {
      acc += dt;
      while (acc >= FIXED_DT) {
        update(FIXED_DT);
        acc -= FIXED_DT;
      }
    }
    draw();
    requestAnimationFrame(loop);
  }
})();
