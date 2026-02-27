const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

function now() { return Date.now(); }
function rid(n = 8) { return crypto.randomBytes(n).toString('hex'); }

const XP_PER_LEVEL = 100;
const RESPAWN_MS = 5000;
const LEVEL_CAP = 100;

const EVOLUTION_POOL = [
  'swift-fins',
  'iron-carapace',
  'venom-spurs',
  'lunge-jets',
  'echo-sense',
  'blood-siphon',
  'chitin-spikes',
  'feral-mandible',
  'tidal-grip',
  'frost-plating'
];

function createZoneGraph() {
  return {
    zones: [
      { id: 'tidal-flats', biome: 'coast', neighbors: ['bog-fen'], resources: { biomass: 120, minerals: 80 } },
      { id: 'bog-fen', biome: 'swamp', neighbors: ['tidal-flats', 'ash-steppe'], resources: { biomass: 150, toxins: 60 } },
      { id: 'ash-steppe', biome: 'volcanic', neighbors: ['bog-fen', 'glacier-rim'], resources: { biomass: 70, minerals: 140 } },
      { id: 'glacier-rim', biome: 'ice', neighbors: ['ash-steppe'], resources: { biomass: 60, crystals: 110 } }
    ]
  };
}

function sampleDraft(playerId, level) {
  // deterministic-ish selection for testability
  const seed = [...`${playerId}:${level}`].reduce((a, c) => a + c.charCodeAt(0), 0);
  const picks = [];
  for (let i = 0; i < 3; i++) {
    picks.push(EVOLUTION_POOL[(seed + i * 3) % EVOLUTION_POOL.length]);
  }
  return [...new Set(picks)];
}

function createWorldServer({ port = 8799 } = {}) {
  const world = createZoneGraph();
  const players = new Map(); // playerId -> state
  const byToken = new Map(); // token -> playerId
  const sockets = new Map(); // playerId -> ws
  const ghosts = new Map(); // playerId -> expiresAt

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'wildlands-world', port, players: players.size, ts: now() }));
  });

  const wss = new WebSocketServer({ server });

  function findSpawnZone() {
    return world.zones[0].id;
  }

  function spawnDarwinState(playerId, reconnectToken) {
    return {
      playerId,
      reconnectToken,
      species: 'darwin',
      x: 0,
      y: 0,
      zoneId: findSpawnZone(),
      level: 1,
      xp: 0,
      hp: 100,
      maxHp: 100,
      vx: 0,
      vy: 0,
      dead: false,
      respawnAt: 0,
      evolutions: [],
      pendingDraft: null
    };
  }

  function publicPlayer(p) {
    return {
      playerId: p.playerId,
      species: p.species,
      x: p.x,
      y: p.y,
      zoneId: p.zoneId,
      level: p.level,
      xp: p.xp,
      hp: p.hp,
      maxHp: p.maxHp,
      dead: p.dead,
      evolutions: p.evolutions,
      pendingDraft: p.pendingDraft,
      connected: sockets.has(p.playerId)
    };
  }

  function snapshotFor(playerId) {
    return {
      type: 'snapshot',
      ts: now(),
      self: playerId,
      world,
      players: [...players.values()].map(publicPlayer)
    };
  }

  function sendToPlayer(playerId, payload) {
    const ws = sockets.get(playerId);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  }

  function broadcastState() {
    const payload = JSON.stringify({
      type: 'stateDelta',
      ts: now(),
      players: [...players.values()].map(publicPlayer)
    });
    for (const ws of sockets.values()) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  function tickResources() {
    for (const z of world.zones) {
      for (const k of Object.keys(z.resources)) {
        z.resources[k] = Math.min(250, z.resources[k] + 1);
      }
    }
  }

  function applyXp(playerId, amount) {
    const p = players.get(playerId);
    if (!p || p.dead) return;
    p.xp += Math.max(0, Number(amount) || 0);

    while (p.level < LEVEL_CAP && p.xp >= p.level * XP_PER_LEVEL) {
      p.level += 1;
      p.maxHp += 8;
      p.hp = p.maxHp;
      p.pendingDraft = sampleDraft(p.playerId, p.level);
      sendToPlayer(playerId, { type: 'evolutionDraft', level: p.level, options: p.pendingDraft });
    }
  }

  function attachPlayer(ws, playerId, resumed = true) {
    sockets.set(playerId, ws);
    ghosts.delete(playerId);
    ws._playerId = playerId;
    ws.send(JSON.stringify({ type: 'welcome', playerId, resumed }));
    ws.send(JSON.stringify(snapshotFor(playerId)));
  }

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', ts: now() }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }

      if (msg.type === 'join') {
        const requestedId = String(msg.playerId || '');
        const token = String(msg.reconnectToken || '');

        if (requestedId && token && byToken.get(token) === requestedId && players.has(requestedId)) {
          attachPlayer(ws, requestedId, true);
          return;
        }

        const playerId = `p_${rid(4)}`;
        const reconnectToken = rid(16);
        const state = spawnDarwinState(playerId, reconnectToken);

        players.set(playerId, state);
        byToken.set(reconnectToken, playerId);
        attachPlayer(ws, playerId, false);
        sendToPlayer(playerId, { type: 'spawn', species: 'darwin', zoneId: state.zoneId });
        return;
      }

      const pid = ws._playerId;
      if (!pid || !players.has(pid)) return;
      const p = players.get(pid);

      if (msg.type === 'input') {
        if (p.dead) return;
        p.vx = Math.max(-1, Math.min(1, Number(msg.dx || 0)));
        p.vy = Math.max(-1, Math.min(1, Number(msg.dy || 0)));
        return;
      }

      if (msg.type === 'feed') {
        // feeding grants small XP packets
        applyXp(pid, Number(msg.amount || 10));
        return;
      }

      if (msg.type === 'combatHit') {
        // combat gives XP and can apply damage for death loop testing
        applyXp(pid, Number(msg.xp || 20));
        const dmg = Math.max(0, Number(msg.damage || 0));
        if (dmg > 0 && !p.dead) {
          p.hp -= dmg;
          if (p.hp <= 0) {
            p.dead = true;
            p.hp = 0;
            p.respawnAt = now() + RESPAWN_MS;
            sendToPlayer(pid, { type: 'death', respawnInMs: RESPAWN_MS });
          }
        }
        return;
      }

      if (msg.type === 'chooseEvolution') {
        const choice = String(msg.choice || '');
        if (!p.pendingDraft || !p.pendingDraft.includes(choice)) return;
        p.evolutions.push(choice);
        p.pendingDraft = null;
        sendToPlayer(pid, { type: 'evolutionChosen', choice, total: p.evolutions.length });
        return;
      }

      if (msg.type === 'resync') {
        ws.send(JSON.stringify(snapshotFor(pid)));
      }
    });

    ws.on('close', () => {
      const pid = ws._playerId;
      if (!pid) return;
      sockets.delete(pid);
      ghosts.set(pid, now() + 60000);
    });
  });

  const simTick = setInterval(() => {
    const t = now();
    for (const p of players.values()) {
      if (p.dead) {
        if (t >= p.respawnAt) {
          p.dead = false;
          p.hp = p.maxHp;
          p.x = 0;
          p.y = 0;
          p.zoneId = findSpawnZone();
          sendToPlayer(p.playerId, { type: 'respawn', zoneId: p.zoneId, hp: p.hp });
        }
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
    }

    for (const [pid, exp] of ghosts) {
      if (t > exp) {
        ghosts.delete(pid);
        players.delete(pid);
      }
    }
  }, 100);

  const stateTick = setInterval(broadcastState, 250);
  const resourceTick = setInterval(tickResources, 1000);

  server.listen(port);

  return {
    port,
    close: () => {
      clearInterval(simTick);
      clearInterval(stateTick);
      clearInterval(resourceTick);
      wss.close();
      server.close();
    }
  };
}

if (require.main === module) {
  const port = process.env.WORLD_PORT ? Number(process.env.WORLD_PORT) : 8799;
  createWorldServer({ port });
  console.log(`wildlands-world listening on :${port}`);
}

module.exports = { createWorldServer };