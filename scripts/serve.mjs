import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.cact': 'application/octet-stream' };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'prototype/demo.html' : pathname.slice(1);
    if (!['prototype/', 'extension/'].some(prefix => relative.startsWith(prefix))) throw new Error('Not found');
    const path = resolve(root, relative);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Not found');
    const bytes = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(bytes);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
}).listen(8787, '127.0.0.1', () => console.log('Prototype: http://127.0.0.1:8787/prototype/demo.html\nCtrl+C to stop.'));
