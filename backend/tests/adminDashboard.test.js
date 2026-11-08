'use strict';

// Tableau de bord administrateur et mesure d'audience (#311).

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const { useMockRedis, closeRedis } = require('./helpers/redis');
const { pool, query } = require('../src/db');
const app = require('../src/app');
const geo = require('../src/services/geo');
const visits = require('../src/services/visits');
const { recordMatch } = require('../src/services/matchRecorder');
const { signToken } = require('../src/middleware/auth');

const request = supertest(app);

// Domaine propre au fichier : les tests tournent en parallèle sur la même base.
const DOMAIN = '@admindashboard.invalid';
// Chemins propres au fichier, pour ne compter que ses visites.
const PAGE = `/test-admin-${process.pid}`;
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148';

// Base de géolocalisation factice : pas de fichier DB-IP en test.
const FAKE_GEO = {
  get: (ip) => (ip === '203.0.113.7'
    ? { country: { iso_code: 'FR' }, subdivisions: [{ names: { en: 'Centre-Val de Loire' } }], city: { names: { en: 'Vendôme' } } }
    : null),
};

async function cleanup() {
  await pool.query(`DELETE FROM visits WHERE path LIKE $1`, [`${PAGE}%`]);
  await pool.query(
    `DELETE FROM games WHERE id IN (
       SELECT gp.game_id FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE u.email LIKE '%' || $1)`,
    [DOMAIN]
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
}

let seq = 0;
async function createUser({ admin = false } = {}) {
  const username = `adm_${process.pid}_${++seq}`;
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified, is_admin)
     VALUES ($1, $2, 'x', TRUE, $3) RETURNING id, username`,
    [username, `${username}${DOMAIN}`, admin]
  );
  return { ...rows[0], token: signToken({ id: rows[0].id, username }) };
}

const visit = (path, { ua = BROWSER, ip = '203.0.113.7', token, referrer, source } = {}) => {
  const req = request.post('/api/visits')
    .set('User-Agent', ua)
    .set('X-Forwarded-For', ip)
    .send({ path, referrer, source });
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

// Lecture seule de la présence (compteurs en direct) : l'index 15 est partagé
// avec d'autres fichiers qui ne font eux aussi que lire.
before(() => { useMockRedis(15); geo.setReader(FAKE_GEO); });
beforeEach(cleanup);
after(async () => {
  await cleanup();
  geo.setReader(null);
  await pool.end();
  await closeRedis();
});

// ─── Accès ────────────────────────────────────────────────────────────────────

test('le tableau de bord exige une session, puis le droit administrateur', async () => {
  assert.equal((await request.get('/api/admin/dashboard')).status, 401);
  const player = await createUser();
  const res = await request.get('/api/admin/dashboard').set('Authorization', `Bearer ${player.token}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.visits, undefined);
});

test('/users/me indique le droit administrateur', async () => {
  const [player, admin] = [await createUser(), await createUser({ admin: true })];
  const me = (u) => request.get('/api/users/me').set('Authorization', `Bearer ${u.token}`);
  assert.equal((await me(player)).body.isAdmin, false);
  assert.equal((await me(admin)).body.isAdmin, true);
});

// ─── Visites ──────────────────────────────────────────────────────────────────

test('une visite est enregistrée avec sa localisation, sans requête ni code d’invitation', async () => {
  const user = await createUser();
  assert.equal((await visit(`${PAGE}?utm=x#ancre`, { token: user.token, referrer: 'https://www.facebook.com/groupe' })).status, 204);
  assert.equal((await visit(`${PAGE}/i/k7m3qx`.replace(PAGE, ''), {})).status, 204);

  const { rows } = await pool.query(
    `SELECT path, host(ip) AS ip, country, region, city, device, referrer_host, user_id, visitor_key
     FROM visits WHERE path = $1`, [PAGE]);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { ...rows[0], visitor_key: rows[0].visitor_key.length },
    { path: PAGE, ip: '203.0.113.7', country: 'FR', region: 'Centre-Val de Loire', city: 'Vendôme',
      device: 'desktop', referrer_host: 'facebook.com', user_id: user.id, visitor_key: 32 },
  );
  const invite = await pool.query(`SELECT 1 FROM visits WHERE path = '/i/:code' AND created_at > NOW() - INTERVAL '1 minute'`);
  assert.ok(invite.rows.length >= 1);
  await pool.query(`DELETE FROM visits WHERE path = '/i/:code' AND host(ip) = '203.0.113.7'`);
});

test('robots, chemins invalides et IP inconnues', async () => {
  await visit(PAGE, { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
  await visit(PAGE, { ua: '' });
  await visit('https://ailleurs.example/page');
  await visit(`${PAGE}/inconnu`, { ip: '198.51.100.1', ua: PHONE });

  const { rows } = await pool.query(
    `SELECT path, country, city, device FROM visits WHERE path LIKE $1`, [`${PAGE}%`]);
  assert.deepEqual(rows, [{ path: `${PAGE}/inconnu`, country: null, city: null, device: 'mobile' }]);
});

test('les IP de plus de 30 jours sont effacées, le reste de la visite est gardé', async () => {
  await visit(PAGE);
  await visit(`${PAGE}/ancienne`);
  await pool.query(
    `UPDATE visits SET created_at = NOW() - INTERVAL '31 days' WHERE path = $1`, [`${PAGE}/ancienne`]);

  assert.ok((await visits.purgeOldIps(query)) >= 1);
  const { rows } = await pool.query(
    `SELECT path, host(ip) AS ip, city FROM visits WHERE path LIKE $1 ORDER BY path`, [`${PAGE}%`]);
  assert.deepEqual(rows, [
    { path: PAGE, ip: '203.0.113.7', city: 'Vendôme' },
    { path: `${PAGE}/ancienne`, ip: null, city: 'Vendôme' },
  ]);
});

test('l’empreinte du visiteur change chaque jour et ne contient pas l’IP', () => {
  const a = visits.visitorKey('203.0.113.7', BROWSER, '2026-11-06');
  assert.equal(a, visits.visitorKey('203.0.113.7', BROWSER, '2026-11-06'));
  assert.notEqual(a, visits.visitorKey('203.0.113.7', BROWSER, '2026-11-07'));
  assert.notEqual(a, visits.visitorKey('203.0.113.8', BROWSER, '2026-11-06'));
  assert.ok(!a.includes('203'));
});

test('type d’appareil', () => {
  assert.equal(visits.deviceOf(PHONE), 'mobile');
  assert.equal(visits.deviceOf('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'), 'tablet');
  assert.equal(visits.deviceOf('Mozilla/5.0 (Linux; Android 15; SM-X710)'), 'tablet');
  assert.equal(visits.deviceOf('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile'), 'mobile');
  assert.equal(visits.deviceOf(BROWSER), 'desktop');
});

// ─── Tableau de bord ──────────────────────────────────────────────────────────

test('le tableau de bord agrège joueurs, temps de jeu et visites', async () => {
  const admin = await createUser({ admin: true });
  const [a, b] = [await createUser(), await createUser()];
  await visit(PAGE, { token: a.token });
  await visit(PAGE, { ua: PHONE });

  // Partie en ligne de 12 minutes, mesurée par le serveur.
  await recordMatch({
    variant: 'classic', target: 3, rated: false, startedAt: Date.now() - 12 * 60 * 1000,
    players: [
      { userId: a.id, name: a.username, seat: 0, score: 3, won: true, facts: {} },
      { userId: b.id, name: b.username, seat: 1, score: 1, won: false, facts: {} },
    ],
  });
  // Partie contre l'ordinateur : durée déclarée, bornée à 3 h.
  const save = await request.post('/api/games').set('Authorization', `Bearer ${a.token}`).send({
    mode: 'ai', variant: 'classic', playerCount: 2, targetScore: 3, difficulty: 'normal', durationSec: 999999,
    players: [{ userId: a.id, score: 3, won: true }, { guestName: 'IA', score: 0, won: false }],
  });
  assert.equal(save.status, 201);
  const durations = await pool.query(
    `SELECT g.mode, ROUND(EXTRACT(EPOCH FROM (g.ended_at - g.created_at)) / 60)::int AS minutes
     FROM games g JOIN game_players gp ON gp.game_id = g.id
     WHERE gp.user_id = $1 ORDER BY g.mode`, [a.id]);
  assert.deepEqual(durations.rows, [{ mode: 'ai', minutes: 180 }, { mode: 'online', minutes: 12 }]);

  const res = await request.get('/api/admin/dashboard?days=7').set('Authorization', `Bearer ${admin.token}`);
  assert.equal(res.status, 200);
  const d = res.body;
  assert.equal(d.days, 7);
  assert.equal(d.ipRetentionDays, 30);
  assert.equal(d.geoSource, 'test', 'base de géolocalisation utilisée');
  // Version déployée : « dev » hors image Docker, date de démarrage du serveur.
  assert.equal(d.server.version, 'dev');
  assert.ok(!Number.isNaN(Date.parse(d.server.startedAt)));
  assert.equal(d.daily.length, 7);
  const today = d.daily[6];
  assert.ok(today.signups >= 3);
  assert.ok(today.activePlayers >= 2);
  assert.ok(today.games.online >= 1 && today.games.ai >= 1);
  assert.ok(today.playMinutes >= 192);
  assert.ok(d.players.active1d >= 2);
  assert.ok(d.playTime.timedGames >= 2);
  assert.ok(d.visits.byDay[6].visits >= 2);
  assert.ok(d.visits.pages.some(p => p.label === PAGE && p.visits === 2 && p.visitors === 2));

  const mine = d.visits.recent.filter(v => v.path === PAGE);
  assert.equal(mine.length, 2);
  const fromA = mine.find(v => v.username === a.username);
  assert.equal(fromA.ip, '203.0.113.7');
  assert.equal(fromA.city, 'Vendôme');
});

test('campagnes : arrivées par lien suivi et inscriptions du jour (#290)', async () => {
  // Noms propres au fichier et au processus : les campagnes sont agrégées sur toute la base.
  const SRC = `affiche-${process.pid}`;
  const OTHER = `facebook-${process.pid}`;
  const ip = '198.51.100.9';
  await visit(PAGE, { ip, source: SRC.toUpperCase() });
  // Le même visiteur s'inscrit, puis revient connecté : compté comme inscrit.
  const newcomer = await createUser();
  await visit(`${PAGE}/jouer`, { ip, token: newcomer.token });
  await visit(PAGE, { ip: '198.51.100.10', ua: PHONE, source: SRC });
  await visit(PAGE, { ip: '198.51.100.11', source: OTHER });
  await visit(PAGE, { ip: '198.51.100.12', source: 'pas une campagne !' });

  const { rows } = await pool.query(`SELECT source FROM visits WHERE path LIKE $1 ORDER BY id`, [`${PAGE}%`]);
  assert.deepEqual(rows.map(r => r.source), [SRC, null, SRC, OTHER, null]);

  const admin = await createUser({ admin: true });
  const res = await request.get('/api/admin/dashboard?days=7').set('Authorization', `Bearer ${admin.token}`);
  const byLabel = Object.fromEntries(res.body.visits.campaigns.map(c => [c.label, c]));
  assert.deepEqual(byLabel[SRC], { label: SRC, visits: 2, visitors: 2, signups: 1 });
  assert.deepEqual(byLabel[OTHER], { label: OTHER, visits: 1, visitors: 1, signups: 0 });
  assert.equal(res.body.visits.recent.find(v => v.path === PAGE && v.source === OTHER)?.source, OTHER);
});

test('nom de campagne nettoyé', () => {
  assert.equal(visits.cleanSource(' QR-Affiche_1 '), 'qr-affiche_1');
  assert.equal(visits.cleanSource(''), null);
  assert.equal(visits.cleanSource('a b'), null);
  assert.equal(visits.cleanSource('x'.repeat(41)), null);
  assert.equal(visits.cleanSource(42), null);
});

test('la période est bornée entre 7 et 365 jours', async () => {
  const admin = await createUser({ admin: true });
  const get = (q) => request.get(`/api/admin/dashboard${q}`).set('Authorization', `Bearer ${admin.token}`);
  assert.equal((await get('?days=2')).body.days, 7);
  assert.equal((await get('?days=9999')).body.days, 365);
  assert.equal((await get('?days=abc')).body.days, 30);
  assert.equal((await get('')).body.daily.length, 30);
});

// ─── Géolocalisation (MaxMind puis DB-IP) ─────────────────────────────────────

test('la base MaxMind passe avant DB-IP, DB-IP sert de secours', () => {
  const [maxmind, dbip] = geo.SOURCES;
  assert.equal(geo.pickSource(p => p === maxmind.path || p === dbip.path), maxmind);
  assert.equal(geo.pickSource(p => p === dbip.path), dbip);
  assert.equal(geo.pickSource(() => false), null);
});

test('les noms de lieux sont en français quand la base les fournit', async () => {
  geo.setReader({
    get: () => ({
      country: { iso_code: 'FR' },
      subdivisions: [{ names: { en: 'Pays de the Loire', fr: 'Pays de la Loire' } }],
      city: { names: { en: 'Le Mans', fr: 'Le Mans' } },
    }),
  });
  try {
    assert.deepEqual(await geo.locate('90.104.126.56'), { country: 'FR', region: 'Pays de la Loire', city: 'Le Mans' });
  } finally {
    geo.setReader(FAKE_GEO);
  }
});
