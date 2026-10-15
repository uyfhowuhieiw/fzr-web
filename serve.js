#!/usr/bin/env node
/* 极简静态服务器 — 仅用于本地预览 web/ 目录 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8123);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + urlPath); return; }
    const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const head = { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-cache' };
    if (req.method === 'HEAD') { res.writeHead(200, head).end(); return; }
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('FZR preview server: http://127.0.0.1:' + PORT + '/  (root: ' + ROOT + ')');
});
