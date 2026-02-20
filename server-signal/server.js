/* Wildlands signaling server (hardened v1)
   - lobbyCode -> host socket
   - playerId + reconnectToken for resume
   - offer/answer/candidate relay between host and each peer
   - expiry + rate limiting + payload validation + structured logs
*/

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

const LOBBY_TTL_MS = 30 * 60 * 1000;
const GHOST_TTL_MS = 60 * 1000;

// Abuse limits (per IP)
const CREATE_PER_MIN = 10;
const JOIN_PER_MIN = 30;
const MAX_MSGS_PER_10S = 200;

const MAX_LOBBIES_PER_IP = 10;
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_CANDIDATES_QUEUED = 64;

function now() { return Date.now(); }

function log(eventType, fields={}){
  // One line JSON; no personal data.
  try {
    const line = JSON.stringify({ ts: now(), eventType, ...fields });
    console.log(line);
  } catch(_) {}
}

function randCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i=0;i<6;i++) s += chars[(Math.random()*chars.length)|0];
  return s;
}

function randId(bytes=8){
  return crypto.randomBytes(bytes).toString('hex');
}

const lobbies = new Map();
// code -> {
//   hostWs,
//   mode,
//   maxPlayers,
//   version,
//   hostPlayerId,
//   hostToken,
//   peers: Map(playerId -> { ws, token, lastSeen, status, candQ })
//   lastActive
// }

const ipState = new Map();
// ip -> { lobbies, winStart10s, msgs10s, minStart, createCount, joinCount }

function getIP(req){
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function getIpState(ip){
  const t = now();
  let st = ipState.get(ip);
  if (!st) {
    st = { lobbies: 0, winStart10s: t, msgs10s: 0, minStart: t, createCount: 0, joinCount: 0 };
    ipState.set(ip, st);
    return st;
  }
  if (t - st.winStart10s > 10_000) { st.winStart10s = t; st.msgs10s = 0; }
  if (t - st.minStart > 60_000) { st.minStart = t; st.createCount = 0; st.joinCount = 0; }
  return st;
}

function allowMessage(ip){
  const st = getIpState(ip);
  st.msgs10s++;
  return st.msgs10s <= MAX_MSGS_PER_10S;
}

function allowCreate(ip){
  const st = getIpState(ip);
  st.createCount++;
  return st.createCount <= CREATE_PER_MIN && (st.lobbies|0) < MAX_LOBBIES_PER_IP;
}

function allowJoin(ip){
  const st = getIpState(ip);
  st.joinCount++;
  return st.joinCount <= JOIN_PER_MIN;
}

function safeSend(ws, obj){
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function closeWS(ws){
  try { ws.close(); } catch(_) {}
}

function cleanupLoop(){
  const t = now();
  for (const [code, lob] of lobbies) {
    // Expire lobby
    if (t - lob.lastActive > LOBBY_TTL_MS) {
      log('lobbyExpired', { lobbyCode: code });
      try { safeSend(lob.hostWs, { type:'lobbyExpired' }); } catch(_){ }
      closeWS(lob.hostWs);
      for (const p of lob.peers.values()) closeWS(p.ws);
      lobbies.delete(code);
      continue;
    }
    // Evict dead ghosts
    for (const [pid, p] of lob.peers) {
      if (p.status === 'ghost' && (t - p.lastSeen) > GHOST_TTL_MS) {
        lob.peers.delete(pid);
        safeSend(lob.hostWs, { type:'peerEvicted', lobbyCode: code, playerId: pid, reason:'ghost_ttl' });
        log('peerEvicted', { lobbyCode: code, playerId: pid, reason:'ghost_ttl' });
      }
    }
  }
}
setInterval(cleanupLoop, 10_000).unref();

const server = http.createServer((req,res)=>{
  res.writeHead(200, { 'content-type':'text/plain' });
  res.end('wildlands-signal ok\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const ip = getIP(req);
  ws._ip = ip;
  ws._role = 'unknown';
  ws._lobby = null;
  ws._playerId = null;

  ws.on('message', (buf) => {
    if (!allowMessage(ip)) { log('rateLimit', { reason:'msgs10s', ip }); return closeWS(ws); }
    if (buf && buf.length > MAX_PAYLOAD_BYTES) { log('reject', { reason:'payload_too_large' }); return; }

    let msg;
    try { msg = JSON.parse(String(buf)); } catch(_) { return; }
    const type = msg && msg.type;
    if (!type) return;

    // CREATE
    if (type === 'createLobby') {
      if (!allowCreate(ip)) {
        safeSend(ws, { type:'createLobbyResult', ok:false, error:'rate_limit' });
        return;
      }
      let code;
      for (let i=0;i<20;i++) { const c = randCode(); if (!lobbies.has(c)) { code = c; break; } }
      if (!code) { safeSend(ws, { type:'createLobbyResult', ok:false, error:'no_codes' }); return; }

      const mode = String(msg.mode||'coop');
      const version = String(msg.version||'');
      const maxPlayers = Math.max(2, Math.min(8, Number(msg.maxPlayers||2)));

      const hostPlayerId = `h_${randId(4)}`;
      const hostToken = randId(16);

      const st = getIpState(ip);
      st.lobbies = (st.lobbies|0) + 1;

      const lob = {
        hostWs: ws,
        mode,
        maxPlayers,
        version,
        hostPlayerId,
        hostToken,
        peers: new Map(),
        lastActive: now()
      };
      lobbies.set(code, lob);

      ws._role = 'host';
      ws._lobby = code;
      ws._playerId = hostPlayerId;

      log('createLobby', { lobbyCode: code, mode, maxPlayers, version });
      safeSend(ws, { type:'createLobbyResult', ok:true, lobbyCode: code, mode, maxPlayers, playerId: hostPlayerId, reconnectToken: hostToken, version });
      return;
    }

    // JOIN / RESUME
    if (type === 'joinLobby') {
      if (!allowJoin(ip)) {
        safeSend(ws, { type:'joinLobbyResult', ok:false, error:'rate_limit' });
        return;
      }
      const code = String(msg.lobbyCode||'').toUpperCase();
      const lob = lobbies.get(code);
      if (!lob || !lob.hostWs || lob.hostWs.readyState !== lob.hostWs.OPEN) {
        safeSend(ws, { type:'joinLobbyResult', ok:false, error:'not_found' });
        return;
      }

      // Version gate
      const version = String(msg.version||'');
      if (lob.version && version && lob.version !== version) {
        safeSend(ws, { type:'joinLobbyResult', ok:false, error:'version_mismatch', hostVersion: lob.version, clientVersion: version });
        log('joinRejected', { lobbyCode: code, reason:'version_mismatch', hostVersion: lob.version, clientVersion: version });
        return;
      }

      const wantPlayerId = msg.playerId ? String(msg.playerId) : '';
      const token = msg.reconnectToken ? String(msg.reconnectToken) : '';

      // Resume if token matches existing slot
      if (wantPlayerId && token) {
        const existing = lob.peers.get(wantPlayerId);
        if (existing && existing.token === token) {
          existing.ws = ws;
          existing.lastSeen = now();
          existing.status = 'connected';
          ws._role = 'peer';
          ws._lobby = code;
          ws._playerId = wantPlayerId;
          lob.lastActive = now();
          safeSend(ws, { type:'joinLobbyResult', ok:true, lobbyCode: code, mode: lob.mode, playerId: wantPlayerId, reconnectToken: token, resumed: true, version: lob.version });
          safeSend(lob.hostWs, { type:'peerRejoined', lobbyCode: code, playerId: wantPlayerId });
          log('peerRejoined', { lobbyCode: code, playerId: wantPlayerId });
          return;
        }
      }

      if (lob.peers.size + 1 >= lob.maxPlayers) {
        safeSend(ws, { type:'joinLobbyResult', ok:false, error:'full' });
        return;
      }

      const playerId = `p_${randId(4)}`;
      const reconnectToken = randId(16);
      lob.peers.set(playerId, { ws, token: reconnectToken, lastSeen: now(), status: 'connected', candQ: 0 });
      lob.lastActive = now();

      ws._role = 'peer';
      ws._lobby = code;
      ws._playerId = playerId;

      safeSend(ws, { type:'joinLobbyResult', ok:true, lobbyCode: code, mode: lob.mode, playerId, reconnectToken, resumed: false, version: lob.version });
      safeSend(lob.hostWs, { type:'peerJoined', lobbyCode: code, playerId });
      log('peerJoined', { lobbyCode: code, playerId });
      return;
    }

    // RELAY
    const code = String(msg.lobbyCode || ws._lobby || '').toUpperCase();
    const lob = lobbies.get(code);
    if (!lob) return;
    lob.lastActive = now();

    // Basic shape validation for relay payload
    if (type === 'relayToHost') {
      if (ws._role !== 'peer') return;
      const payload = msg.payload;
      if (!payload || typeof payload !== 'object') return;
      if (payload.t === 'candidate') {
        const p = lob.peers.get(ws._playerId);
        if (p) {
          p.candQ = (p.candQ|0) + 1;
          if (p.candQ > MAX_CANDIDATES_QUEUED) return;
        }
      }
      safeSend(lob.hostWs, { type:'relayFromPeer', lobbyCode: code, playerId: ws._playerId, payload });
      return;
    }

    if (type === 'relayToPeer') {
      if (ws._role !== 'host') return;
      const playerId = String(msg.playerId||'');
      const payload = msg.payload;
      if (!playerId || !payload || typeof payload !== 'object') return;
      const p = lob.peers.get(playerId);
      if (!p || !p.ws) return;
      safeSend(p.ws, { type:'relayFromHost', lobbyCode: code, payload });
      return;
    }

    if (type === 'kickPeer' && ws._role === 'host') {
      const playerId = String(msg.playerId||'');
      const p = lob.peers.get(playerId);
      if (p && p.ws) {
        safeSend(p.ws, { type:'kicked' });
        closeWS(p.ws);
        lob.peers.delete(playerId);
        log('peerKicked', { lobbyCode: code, playerId });
      }
    }
  });

  ws.on('close', () => {
    const code = ws._lobby;
    if (!code) return;
    const lob = lobbies.get(code);
    if (!lob) return;

    if (ws._role === 'host') {
      // close lobby
      for (const p of lob.peers.values()) {
        safeSend(p.ws, { type:'lobbyClosed' });
        closeWS(p.ws);
      }
      lobbies.delete(code);
      log('lobbyClosed', { lobbyCode: code });
      return;
    }

    if (ws._role === 'peer') {
      const pid = ws._playerId;
      const p = lob.peers.get(pid);
      if (p) {
        p.ws = null;
        p.status = 'ghost';
        p.lastSeen = now();
      }
      safeSend(lob.hostWs, { type:'peerLeft', lobbyCode: code, playerId: pid });
      log('peerLeft', { lobbyCode: code, playerId: pid });
    }
  });

  safeSend(ws, { type:'hello', serverTime: now() });
});

server.listen(PORT, () => {
  log('listen', { port: PORT });
});
