#!/usr/bin/env node
// Minimal stdlib-only HTTP sink for SessionLogger uploads.
//
// Usage:
//   node scripts/telemetry-server.js
//   PORT=12000 OUT_DIR=./telemetry/sessions TELEMETRY_TOKEN=secret node scripts/telemetry-server.js
//
// Exposed routes (CORS: *, so file:// and ngrok both work):
//   GET  /health         → 200 "ok"
//   POST /sessions       → writes body as JSON into OUT_DIR/<id>.json
//   OPTIONS *            → CORS preflight
//
// Client side: js/session-logger.js → uploadSession()/uploadAllLocal().
// Filename is derived from the session `id`, so re-uploading the same
// session is idempotent (overwrites) — safe for bulk backfill.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '12000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const OUT_DIR = path.resolve(process.env.OUT_DIR || './telemetry/sessions');
const TOKEN = process.env.TELEMETRY_TOKEN || null;
const MAX_BODY = 4 * 1024 * 1024; // 4 MiB — sessions are ~50-500 KB

fs.mkdirSync(OUT_DIR, { recursive: true });

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Telemetry-Token, ngrok-skip-browser-warning',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, body, extraHeaders = {}) {
  const headers = { ...CORS_HEADERS, ...extraHeaders };
  if (typeof body === 'object' && body !== null) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  res.writeHead(status, headers);
  res.end(body);
}

function sanitizeId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

function checkToken(req, url) {
  if (!TOKEN) return true;
  const header = req.headers['x-telemetry-token'];
  if (header && header === TOKEN) return true;
  const qs = url.searchParams.get('token');
  if (qs && qs === TOKEN) return true;
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const started = Date.now();
  const log = (status, extra = '') => {
    const ms = Date.now() - started;
    console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} → ${status} ${ms}ms ${extra}`);
  };

  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true, outDir: OUT_DIR });
    log(200);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/sessions') {
    if (!checkToken(req, url)) {
      send(res, 401, { error: 'bad token' });
      log(401);
      return;
    }
    let raw;
    try {
      raw = await readBody(req);
    } catch (e) {
      send(res, e.status || 400, { error: e.message });
      log(e.status || 400);
      return;
    }
    let session;
    try {
      session = JSON.parse(raw);
    } catch (e) {
      send(res, 400, { error: 'invalid json' });
      log(400);
      return;
    }
    if (!session || typeof session.id !== 'string' || !session.id) {
      send(res, 400, { error: 'missing session.id' });
      log(400);
      return;
    }
    const fname = `${sanitizeId(session.id)}.json`;
    const fpath = path.join(OUT_DIR, fname);
    try {
      fs.writeFileSync(fpath, JSON.stringify(session, null, 2));
    } catch (e) {
      send(res, 500, { error: 'write failed' });
      log(500, e.message);
      return;
    }
    send(res, 200, { ok: true, id: session.id, file: fname, bytes: raw.length });
    log(200, `${raw.length}b → ${fname}`);
    return;
  }

  send(res, 404, { error: 'not found' });
  log(404);
});

server.listen(PORT, HOST, () => {
  console.log(`telemetry-server listening on http://${HOST}:${PORT}`);
  console.log(`  OUT_DIR: ${OUT_DIR}`);
  console.log(`  token:   ${TOKEN ? 'required' : 'none'}`);
});

process.on('SIGINT', () => {
  console.log('\nshutting down');
  server.close(() => process.exit(0));
});
