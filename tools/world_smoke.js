const { WebSocket } = require('ws');
const { createWorldServer } = require('../server-world/world-server');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  const port = 8899;
  const srv = createWorldServer({ port });

  const events = [];
  let welcome;
  let draft;

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    events.push(m);
    if (m.type === 'welcome' && !welcome) welcome = m;
    if (m.type === 'evolutionDraft' && !draft) draft = m;
  });

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  ws.send(JSON.stringify({ type: 'join', name: 'smoke' }));
  await sleep(700);
  ws.send(JSON.stringify({ type: 'feed', amount: 120 }));
  await sleep(700);

  if (!draft || !Array.isArray(draft.options) || !draft.options.length) {
    throw new Error(`missing evolutionDraft (seen: ${events.map((e) => e.type).join(',')})`);
  }

  ws.send(JSON.stringify({ type: 'chooseEvolution', choice: draft.options[0] }));
  await sleep(300);
  ws.send(JSON.stringify({ type: 'combatHit', damage: 999, xp: 0 }));

  await sleep(6000);

  const need = ['welcome', 'spawn', 'evolutionDraft', 'evolutionChosen', 'death', 'respawn'];
  const have = new Set(events.map((e) => e.type));
  for (const n of need) {
    if (!have.has(n)) throw new Error(`missing event: ${n} (seen: ${[...have].join(',')})`);
  }

  ws.close();

  // reconnect + resync persistence
  const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
  const events2 = [];
  ws2.on('message', (raw) => events2.push(JSON.parse(String(raw))));

  await new Promise((resolve, reject) => {
    ws2.on('open', resolve);
    ws2.on('error', reject);
  });

  ws2.send(JSON.stringify({ type: 'join', playerId: welcome.playerId, reconnectToken: welcome.reconnectToken }));
  await sleep(500);
  ws2.send(JSON.stringify({ type: 'resync' }));
  await sleep(700);

  const snap = events2.find((e) => e.type === 'snapshot');
  if (!snap) throw new Error(`missing snapshot on reconnect (seen: ${events2.map((e) => e.type).join(',')})`);
  const self = (snap.players || []).find((p) => p.playerId === welcome.playerId);
  if (!self) throw new Error('missing self player in snapshot');
  if ((self.level || 0) < 2) throw new Error('xp/level did not persist');
  if (!Array.isArray(self.evolutions) || self.evolutions.length < 1) throw new Error('evolution selection did not persist');

  ws2.close();
  srv.close();
  console.log('WORLD_SMOKE_PASS');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});