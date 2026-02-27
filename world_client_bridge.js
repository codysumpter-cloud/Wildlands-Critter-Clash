(function () {
  'use strict';

  const WS_URL = (window.WCC_WORLD_WS || 'ws://127.0.0.1:8799');
  let ws = null;
  let connected = false;
  let reconnectAt = 0;
  let playerId = null;
  let reconnectToken = null;
  let apex = null;
  let territory = null;
  let self = null;
  let players = [];

  const keys = new Set();
  window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  function mkOverlay() {
    const el = document.createElement('div');
    el.id = 'wccNetHud';
    el.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'z-index:9999',
      'background:rgba(0,0,0,.65)', 'color:#dff', 'padding:8px 10px',
      'font:12px/1.35 ui-monospace,Consolas,monospace', 'border-radius:8px',
      'border:1px solid rgba(255,255,255,.15)', 'max-width:340px',
      'pointer-events:none', 'white-space:pre-line'
    ].join(';');
    document.body.appendChild(el);
    return el;
  }
  const hud = mkOverlay();

  function hudText() {
    const p = self || {};
    const apexTxt = apex && apex.playerId ? `${apex.playerId} (L${apex.level})` : 'none';
    const terr = territory ? Object.entries(territory).map(([k, v]) => `${k}:${v.controller || '-'}:${v.pressure}`).slice(0, 2).join(' | ') : 'n/a';
    return [
      `NET: ${connected ? 'ONLINE' : 'OFFLINE'}`,
      `ID: ${playerId || '-'}`,
      `LVL/XP: ${p.level || 1}/${p.xp || 0}`,
      `HP: ${p.hp || 0}/${p.maxHp || 0}`,
      `EVO: ${(p.evolutions || []).length || 0}`,
      `APEX: ${apexTxt}`,
      `PLAYERS: ${players.length}`,
      `TERR: ${terr}`
    ].join('\n');
  }

  function refreshHud() { hud.textContent = hudText(); }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function connect() {
    try {
      ws = new WebSocket(WS_URL);
    } catch (_) {
      reconnectAt = Date.now() + 2000;
      return;
    }

    ws.addEventListener('open', () => {
      connected = true;
      if (playerId && reconnectToken) send({ type: 'join', playerId, reconnectToken });
      else send({ type: 'join', name: 'web-player' });
      refreshHud();
    });

    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }

      if (m.type === 'welcome') {
        if (m.playerId) playerId = m.playerId;
        if (m.reconnectToken) reconnectToken = m.reconnectToken;
      }

      if (m.type === 'snapshot' || m.type === 'stateDelta') {
        players = Array.isArray(m.players) ? m.players : players;
        if (m.apex) apex = m.apex;
        if (m.territory) territory = m.territory;
        if (playerId && players.length) {
          const found = players.find((p) => p.playerId === playerId);
          if (found) self = found;
        }
        refreshHud();
      }

      if (m.type === 'apexUpdate') { apex = m.apex || apex; refreshHud(); }
      if (m.type === 'territoryUpdate') { territory = m.territory || territory; refreshHud(); }
    });

    ws.addEventListener('close', () => {
      connected = false;
      refreshHud();
      reconnectAt = Date.now() + 2000;
    });

    ws.addEventListener('error', () => {
      connected = false;
      refreshHud();
    });
  }

  function inputLoop() {
    if (connected) {
      let dx = 0, dy = 0;
      if (keys.has('w') || keys.has('arrowup')) dy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dy += 1;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;
      send({ type: 'input', dx, dy });

      // lightweight feeding/combat hooks for loop verification
      if (keys.has('f')) send({ type: 'feed', amount: 8 });
      if (keys.has('h')) send({ type: 'combatHit', xp: 12, damage: 0 });
      if (keys.has('k')) send({ type: 'combatHit', xp: 0, damage: 30 });

      // zone test hotkeys 1-4
      if (keys.has('1')) send({ type: 'moveZone', zoneId: 'tidal-flats' });
      if (keys.has('2')) send({ type: 'moveZone', zoneId: 'bog-fen' });
      if (keys.has('3')) send({ type: 'moveZone', zoneId: 'ash-steppe' });
      if (keys.has('4')) send({ type: 'moveZone', zoneId: 'glacier-rim' });
    } else if (Date.now() > reconnectAt) {
      connect();
    }

    requestAnimationFrame(inputLoop);
  }

  connect();
  inputLoop();
  refreshHud();
})();
