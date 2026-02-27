const { WebSocket } = require('ws');
const { createWorldServer } = require('../server-world/world-server');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  const port = 8900;
  const clients = 16;
  const srv = createWorldServer({ port, levelCap: 100 });

  const sockets = [];
  const stats = { hello: 0, welcome: 0, snapshot: 0, stateDelta: 0, errors: 0 };

  for (let i = 0; i < clients; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (stats[m.type] !== undefined) stats[m.type]++;
      if (m.type === 'hello') ws.send(JSON.stringify({ type: 'join', name: `bot-${i}` }));
    });
    ws.on('error', () => { stats.errors++; });
    sockets.push(ws);
  }

  // jittered input spam for 5s
  const start = Date.now();
  while (Date.now() - start < 5000) {
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1;
        ws.send(JSON.stringify({ type: 'input', dx, dy }));
      }
    }
    await sleep(100);
  }

  await sleep(700);

  for (const ws of sockets) {
    try { ws.close(); } catch (_) {}
  }
  srv.close();

  if (stats.welcome < clients) throw new Error(`welcome_count_low: ${stats.welcome}/${clients}`);
  if (stats.snapshot < clients) throw new Error(`snapshot_count_low: ${stats.snapshot}/${clients}`);
  if (stats.stateDelta < clients) throw new Error(`state_delta_low: ${stats.stateDelta}`);

  console.log('WORLD_SOAK_PASS', JSON.stringify(stats));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});