const { WebSocket } = require('ws');
const { createWorldServer } = require('../server-world/world-server');

async function run() {
  const port = 8899;
  const srv = createWorldServer({ port });

  const events = [];
  let welcome;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    const t = setTimeout(() => reject(new Error('timeout')), 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', name: 'smoke' }));
      ws.send(JSON.stringify({ type: 'input', dx: 1, dy: 0 }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      events.push(msg.type);
      if (msg.type === 'welcome') welcome = msg;
      if (events.includes('snapshot') && events.includes('stateDelta') && welcome) {
        clearTimeout(t);
        ws.close();
        resolve();
      }
    });

    ws.on('error', reject);
  });

  // reconnect test
  await new Promise((resolve, reject) => {
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
    const t = setTimeout(() => reject(new Error('reconnect-timeout')), 10000);
    let resumed = false;

    ws2.on('open', () => {
      ws2.send(JSON.stringify({ type: 'join', playerId: welcome.playerId, reconnectToken: welcome.reconnectToken }));
      ws2.send(JSON.stringify({ type: 'resync' }));
    });

    ws2.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'welcome' && msg.resumed) resumed = true;
      if (resumed && msg.type === 'snapshot') {
        clearTimeout(t);
        ws2.close();
        resolve();
      }
    });

    ws2.on('error', reject);
  });

  srv.close();
  console.log('WORLD_SMOKE_PASS');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
