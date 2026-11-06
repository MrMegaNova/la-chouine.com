'use strict';

// Arrêt propre (#237) : séquence unitaire, puis un vrai SIGTERM envoyé au
// serveur avec un WebSocket ouvert (seulement avec un vrai Redis, comme en CI).

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');

const { createShutdown } = require('../src/shutdown');

const silent = { info() {}, error() {} };

function fakeServer() {
  const calls = [];
  return {
    calls,
    listening: true,
    close(cb) { calls.push('http'); setImmediate(cb); },
    closeIdleConnections() { calls.push('idle'); },
  };
}

test('séquence : temps réel, HTTP, puis base et Redis, sortie 0', async () => {
  const server = fakeServer();
  const exits = [];
  const shutdown = createShutdown({
    server,
    getRealtime: () => ({ stop: () => server.calls.push('realtime') }),
    closeDb: async () => { server.calls.push('db'); },
    closeRedis: async () => { server.calls.push('redis'); },
    logger: silent,
    exit: (code) => exits.push(code),
  });
  await shutdown('SIGTERM');
  assert.deepEqual(server.calls.slice(0, 3), ['realtime', 'http', 'idle']);
  assert.deepEqual(server.calls.slice(3).sort(), ['db', 'redis']);
  assert.deepEqual(exits, [0]);

  await shutdown('SIGINT'); // second signal : rien de plus
  assert.deepEqual(exits, [0]);
});

test('un arrêt bloqué sort en 1 après le délai', async () => {
  const server = { listening: true, close() {}, closeIdleConnections() {} }; // ne se ferme jamais
  const exits = [];
  const shutdown = createShutdown({
    server, getRealtime: () => null, closeDb: async () => {}, closeRedis: async () => {},
    logger: silent, exit: (code) => exits.push(code), timeoutMs: 30,
  });
  shutdown('SIGTERM');
  const deadline = Date.now() + 2000;
  while (exits.length === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(exits, [1]);
});

test('une fermeture en échec n’empêche pas la sortie', async () => {
  const server = fakeServer();
  const exits = [];
  const shutdown = createShutdown({
    server, getRealtime: () => null,
    closeDb: async () => { throw new Error('déjà fermée'); },
    closeRedis: async () => {},
    logger: silent, exit: (code) => exits.push(code),
  });
  await shutdown('SIGTERM');
  assert.deepEqual(exits, [0]);
});

// ─── Bout en bout ─────────────────────────────────────────────────────────────

const real = process.env.REDIS_TEST_REAL === '1';
const DOMAIN = '@shutdown.invalid';

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const health = (port) => new Promise((resolve) => {
  http.get(`http://127.0.0.1:${port}/api/health`, (res) => { res.resume(); resolve(res.statusCode); })
    .on('error', () => resolve(0));
});

test('SIGTERM avec un WebSocket ouvert : sortie 0 en moins de 5 s', { skip: !real && 'vrai Redis requis' }, async (t) => {
  const { pool } = require('../src/db');
  const { signToken } = require('../src/middleware/auth');
  after(async () => {
    await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
    await pool.end();
  });
  const username = `stop_${process.pid}`;
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, 'x', TRUE) RETURNING id`,
    [username, `${username}${DOMAIN}`]
  );

  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '../src/server.js')], {
    // Index Redis 0 (aucun fichier de test ne l'utilise) et canaux pub/sub isolés.
    env: { ...process.env, PORT: String(port), RT_NS: `shutdown-${process.pid}:`, LOG_LEVEL: 'silent' },
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });

  const deadline = Date.now() + 10000;
  while ((await health(port)) !== 200) {
    if (Date.now() > deadline) assert.fail('le serveur n’a pas démarré');
    await new Promise(r => setTimeout(r, 50));
  }

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${signToken({ id: rows[0].id, username })}`);
  const hello = new Promise((resolve, reject) => {
    ws.on('message', (d) => { if (JSON.parse(d.toString()).t === 'hello') resolve(); });
    ws.on('error', reject);
  });
  const closed = new Promise((resolve) => ws.on('close', resolve));
  await hello;

  const started = Date.now();
  child.kill('SIGTERM');
  const { code, signal } = await exited;
  const elapsed = Date.now() - started;
  await closed;

  assert.equal(signal, null, 'pas tué par un signal');
  assert.equal(code, 0);
  assert.ok(elapsed < 5000, `arrêt en ${elapsed} ms`);
});
