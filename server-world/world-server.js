const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

function now() { return Date.now(); }
function rid(n = 8) { return crypto.randomBytes(n).toString('hex'); }

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

  function snapshotFor(playerId) {
    return {
      type: 'snapshot',
      ts: now(),
      self: playerId,
      world,
      players: [...players.values()].map((p) => ({
        playerId: p.playerId,
        x: p.x,
        y: p.y,
        zoneId: p.zoneId,
        level: p.level,
        hp: p.hp,
        connected: sockets.has(p.playerId)
      }))
    };
  }

  function broadcastState() {
    const payload = JSON.stringify({
      type: 'stateDelta',
      ts: now(),
      players: [...players.values()].map((p) => ({ playerId: p.playerId, x: p.x, y: p.y, zoneId: p.zoneId, level: p.level, hp: p.hp }))
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

  function findSpawnZone() {
    return world.zones[0].id;
  }

  function attachPlayer(ws, playerId) {
    sockets.set(playerId, ws);
    ghosts.delete(playerId);
    ws._playerId = playerId;
    ws.send(JSON.stringify({ type: 'welcome', playerId, resumed: true }));
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
          attachPlayer(ws, requestedId);
          return;
        }

        const playerId = `p_${rid(4)}`;
        const reconnectToken = rid(16);
        const state = {
          playerId,
          reconnectToken,
          x: 0,
          y: 0,
          zoneId: findSpawnZone(),
          level: 1,
          hp: 100,
          vx: 0,
          vy: 0
        };
        players.set(playerId, state);
        byToken.set(reconnectToken, playerId);
        sockets.set(playerId, ws);
        ws._playerId = playerId;
        ws.send(JSON.stringify({ type: 'welcome', playerId, reconnectToken, resumed: false }));
        ws.send(JSON.stringify(snapshotFor(playerId)));
        return;
      }

      if (msg.type === 'input') {
        const pid = ws._playerId;
        if (!pid || !players.has(pid)) return;
        const p = players.get(pid);
        p.vx = Math.max(-1, Math.min(1, Number(msg.dx || 0)));
        p.vy = Math.max(-1, Math.min(1, Number(msg.dy || 0)));
        return;
      }

      if (msg.type === 'resync') {
        const pid = ws._playerId;
        if (!pid || !players.has(pid)) return;
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
    for (const p of players.values()) {
      p.x += p.vx;
      p.y += p.vy;
    }
    for (const [pid, exp] of ghosts) {
      if (now() > exp) {
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
