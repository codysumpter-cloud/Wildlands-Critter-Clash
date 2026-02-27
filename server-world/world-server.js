const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

function now() { return Date.now(); }
function rid(n = 8) { return crypto.randomBytes(n).toString('hex'); }

const XP_PER_LEVEL = 100;
const RESPAWN_MS = 5000;
const LEVEL_CAP_DEFAULT = 100;

const EVOLUTION_POOL = [
  'swift-fins', 'iron-carapace', 'venom-spurs', 'lunge-jets', 'echo-sense',
  'blood-siphon', 'chitin-spikes', 'feral-mandible', 'tidal-grip', 'frost-plating'
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
  const seed = [...`${playerId}:${level}`].reduce((a, c) => a + c.charCodeAt(0), 0);
  const picks = [];
  for (let i = 0; i < 3; i++) picks.push(EVOLUTION_POOL[(seed + i * 3) % EVOLUTION_POOL.length]);
  return [...new Set(picks)];
}

function createWorldServer({ port = 8799, levelCap = LEVEL_CAP_DEFAULT } = {}) {
  const world = createZoneGraph();
  const players = new Map();
  const byToken = new Map();
  const sockets = new Map();
  const ghosts = new Map();
  const territory = new Map(world.zones.map((z) => [z.id, { controller: null, pressure: 0 }]));
  let apex = { playerId: null, level: 0, xp: 0, apexScore: 0 };
  const startedAt = now();
  const metrics = {
    ticks: { sim: 0, state: 0, objective: 0 },
    avgMs: { sim: 0, state: 0, objective: 0 },
    maxMs: { sim: 0, state: 0, objective: 0 }
  };

  function trackTick(name, durationMs) {
    metrics.ticks[name]++;
    const n = metrics.ticks[name];
    metrics.avgMs[name] = ((metrics.avgMs[name] * (n - 1)) + durationMs) / n;
    metrics.maxMs[name] = Math.max(metrics.maxMs[name], durationMs);
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/metrics') {
      const payload = {
        ok: true,
        service: 'wildlands-world',
        port,
        levelCap,
        ts: now(),
        uptimeMs: now() - startedAt,
        players: {
          total: players.size,
          connected: sockets.size,
          ghosts: ghosts.size
        },
        metrics
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'wildlands-world', port, players: players.size, levelCap, ts: now() }));
  });

  const wss = new WebSocketServer({ server });

  function findSpawnZone() { return world.zones[0].id; }

  function spawnDarwinState(playerId, reconnectToken) {
    return {
      playerId,
      reconnectToken,
      species: 'darwin',
      x: 0, y: 0,
      zoneId: findSpawnZone(),
      level: 1,
      xp: 0,
      hp: 100,
      maxHp: 100,
      vx: 0, vy: 0,
      dead: false,
      respawnAt: 0,
      evolutions: [],
      pendingDraft: null,
      apexScore: 0
    };
  }

  function publicPlayer(p) {
    return {
      playerId: p.playerId,
      species: p.species,
      x: p.x, y: p.y,
      zoneId: p.zoneId,
      level: p.level,
      xp: p.xp,
      hp: p.hp,
      maxHp: p.maxHp,
      dead: p.dead,
      evolutions: p.evolutions,
      pendingDraft: p.pendingDraft,
      apexScore: p.apexScore,
      connected: sockets.has(p.playerId)
    };
  }

  function snapshotFor(playerId) {
    return {
      type: 'snapshot',
      ts: now(),
      self: playerId,
      world,
      levelCap,
      apex,
      territory: Object.fromEntries(territory),
      players: [...players.values()].map(publicPlayer)
    };
  }

  function sendToPlayer(playerId, payload) {
    const ws = sockets.get(playerId);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  }

  function broadcast(obj) {
    const payload = JSON.stringify(obj);
    for (const ws of sockets.values()) if (ws.readyState === ws.OPEN) ws.send(payload);
  }

  function broadcastState() {
    broadcast({
      type: 'stateDelta',
      ts: now(),
      apex,
      territory: Object.fromEntries(territory),
      players: [...players.values()].map(publicPlayer)
    });
  }

  function updateApex() {
    let best = null;
    for (const p of players.values()) {
      if (p.dead) continue;
      if (!best) { best = p; continue; }
      if (p.level !== best.level) { if (p.level > best.level) best = p; continue; }
      if (p.xp !== best.xp) { if (p.xp > best.xp) best = p; continue; }
      if (p.apexScore > best.apexScore) best = p;
    }

    const next = best
      ? { playerId: best.playerId, level: best.level, xp: best.xp, apexScore: best.apexScore }
      : { playerId: null, level: 0, xp: 0, apexScore: 0 };

    if (next.playerId !== apex.playerId || next.level !== apex.level || next.xp !== apex.xp || next.apexScore !== apex.apexScore) {
      apex = next;
      broadcast({ type: 'apexUpdate', ts: now(), apex });
    }
  }

  function tickResourcesAndTerritory() {
    const zoneOccupants = new Map(world.zones.map((z) => [z.id, []]));
    for (const p of players.values()) {
      if (!p.dead && zoneOccupants.has(p.zoneId)) zoneOccupants.get(p.zoneId).push(p.playerId);
    }

    for (const z of world.zones) {
      const occupants = zoneOccupants.get(z.id);
      const t = territory.get(z.id);

      // baseline regen
      for (const k of Object.keys(z.resources)) z.resources[k] = Math.min(250, z.resources[k] + 1);

      // territory pressure
      if (occupants.length === 1) {
        const owner = occupants[0];
        if (t.controller === owner) t.pressure = Math.min(100, t.pressure + 10);
        else {
          t.pressure += 10;
          if (t.pressure >= 30) {
            t.controller = owner;
            t.pressure = 30;
          }
        }
      } else if (occupants.length === 0) {
        t.pressure = Math.max(0, t.pressure - 4);
        if (t.pressure === 0) t.controller = null;
      } else {
        // contested
        t.pressure = Math.max(0, t.pressure - 6);
      }

      // objective/resource pressure: controllers drain biomass slower but gain apex score
      if (t.controller) {
        z.resources.biomass = Math.max(0, z.resources.biomass - 2);
        const p = players.get(t.controller);
        if (p && !p.dead) p.apexScore += 1;
      }

      if (z.resources.biomass <= 20) {
        broadcast({ type: 'resourcePressure', ts: now(), zoneId: z.id, biomass: z.resources.biomass });
      }
    }

    broadcast({ type: 'territoryUpdate', ts: now(), territory: Object.fromEntries(territory) });
  }

  function applyXp(playerId, amount) {
    const p = players.get(playerId);
    if (!p || p.dead) return;
    p.xp += Math.max(0, Number(amount) || 0);

    while (p.level < levelCap && p.xp >= p.level * XP_PER_LEVEL) {
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

      if (msg.type === 'moveZone') {
        const zoneId = String(msg.zoneId || '');
        if (world.zones.some((z) => z.id === zoneId)) p.zoneId = zoneId;
        return;
      }

      if (msg.type === 'feed') {
        applyXp(pid, Number(msg.amount || 10));
        return;
      }

      if (msg.type === 'combatHit') {
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

      if (msg.type === 'resync') ws.send(JSON.stringify(snapshotFor(pid)));
    });

    ws.on('close', () => {
      const pid = ws._playerId;
      if (!pid) return;
      sockets.delete(pid);
      ghosts.set(pid, now() + 60000);
    });
  });

  const simTick = setInterval(() => {
    const t0 = now();
    const t = t0;
    for (const p of players.values()) {
      if (p.dead) {
        if (t >= p.respawnAt) {
          p.dead = false;
          p.hp = p.maxHp;
          p.x = 0; p.y = 0;
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

    updateApex();
    trackTick('sim', now() - t0);
  }, 100);

  const stateTick = setInterval(() => {
    const t0 = now();
    broadcastState();
    trackTick('state', now() - t0);
  }, 250);

  const objectiveTick = setInterval(() => {
    const t0 = now();
    tickResourcesAndTerritory();
    updateApex();
    trackTick('objective', now() - t0);
  }, 1000);

  server.listen(port);

  return {
    port,
    close: () => {
      clearInterval(simTick);
      clearInterval(stateTick);
      clearInterval(objectiveTick);
      wss.close();
      server.close();
    }
  };
}

if (require.main === module) {
  const port = process.env.WORLD_PORT ? Number(process.env.WORLD_PORT) : 8799;
  const levelCap = process.env.LEVEL_CAP ? Number(process.env.LEVEL_CAP) : LEVEL_CAP_DEFAULT;
  createWorldServer({ port, levelCap });
  console.log(`wildlands-world listening on :${port} (levelCap=${levelCap})`);
}

module.exports = { createWorldServer };