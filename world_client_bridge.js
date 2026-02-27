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

  const hud = document.getElementById('netHudNative');
  const apexBanner = document.getElementById('apexBanner');
  const territoryPanel = document.getElementById('territoryPanel');

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function territoryText() {
    if (!territory) return 'Territory: n/a';
    const rows = Object.entries(territory)
      .map(([zone, t]) => `${zone}: ${t.controller || '-'} (${t.pressure})`)
      .join(' | ');
    return `Territory: ${rows}`;
  }

  function refreshUi() {
    const p = self || {};
    if (hud) {
      hud.textContent = [
        `NET:${connected ? 'ONLINE' : 'OFFLINE'}`,
        `ID:${playerId || '-'}`,
        `L${p.level || 1} XP:${p.xp || 0}`,
        `HP:${p.hp || 0}/${p.maxHp || 0}`,
        `EVO:${(p.evolutions || []).length || 0}`,
        `P:${players.length}`
      ].join('  ');
    }

    if (apexBanner) {
      if (apex && apex.playerId) {
        apexBanner.textContent = `APEX: ${apex.playerId} (L${apex.level}, score ${apex.apexScore})`;
      } else {
        apexBanner.textContent = 'APEX: none';
      }
    }

    if (territoryPanel) {
      territoryPanel.textContent = territoryText();
    }
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
      refreshUi();
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
        refreshUi();
      }

      if (m.type === 'apexUpdate') {
        apex = m.apex || apex;
        refreshUi();
      }
      if (m.type === 'territoryUpdate') {
        territory = m.territory || territory;
        refreshUi();
      }
      if (m.type === 'resourcePressure' && territoryPanel) {
        territoryPanel.textContent = `${territoryText()}  |  PRESSURE: ${m.zoneId} biomass=${m.biomass}`;
      }
    });

    ws.addEventListener('close', () => {
      connected = false;
      refreshUi();
      reconnectAt = Date.now() + 2000;
    });

    ws.addEventListener('error', () => {
      connected = false;
      refreshUi();
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

      if (keys.has('f')) send({ type: 'feed', amount: 8 });
      if (keys.has('h')) send({ type: 'combatHit', xp: 12, damage: 0 });
      if (keys.has('k')) send({ type: 'combatHit', xp: 0, damage: 30 });

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
  refreshUi();
})();