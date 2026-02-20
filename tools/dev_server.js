// dev_server.js - zero-dep static server for local dev (file:// safe alternative)
// Usage: npm run dev  -> http://localhost:8000/PLAY_WILDLANDS.html

import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

function safeJoin(base, requested) {
  const p = path.normalize(path.join(base, requested));
  if (!p.startsWith(base)) return null;
  return p;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(u.pathname);
  if (pathname === '/') pathname = '/PLAY_WILDLANDS.html';

  const filePath = safeJoin(root, pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, () => {
  // Keep output minimal; this is a dev convenience script.
  console.log(`Dev server running at http://localhost:${port}/PLAY_WILDLANDS.html`);
});
