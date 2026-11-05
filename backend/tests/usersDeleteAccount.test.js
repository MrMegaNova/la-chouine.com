'use strict';

// Suppression de compte (RGPD, #238) : route, anonymisation, forfait d'une
// partie en cours, sortie de file et de défi, fermeture des WebSockets. Tests
// d'intégration sur la vraie base : l'ordre forfait → enregistrement →
// suppression ne se vérifie qu'avec les contraintes réelles.

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test, before, beforeEach, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { WebSocket } = require('ws');

const { useMockRedis, flush, closeRedis } = require('./helpers/redis');
const { pool } = require('../src/db');
const app = require('../src/app');
const bus = require('../src/realtime/bus');
const sessionStore = require('../src/realtime/sessionStore');
const matchmakingStore = require('../src/realtime/matchmakingStore');
const presenceStore = require('../src/realtime/presenceStore');
const accountRemoval = require('../src/realtime/accountRemoval');
const { recordMatch } = require('../src/services/matchRecorder');
const { attachWebSocketServer } = require('../src/realtime/wsServer');
const { signToken, checkTokenVersion } = require('../src/middleware/auth');

// Domaine propre au fichier : les tests tournent en parallèle sur la même base.
const DOMAIN = '@usersdeleteaccount.invalid';
const PASSWORD = 'Motdepasse123!';
const hash = bcrypt.hashSync(PASSWORD, 4);

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const once = (em, ev) => new Promise(res => em.once(ev, res));

async function waitFor(pred, what, timeout = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await pred()) return;
    await delay(10);
  }
  assert.fail(`attente expirée : ${what}`);
}

async function cleanup() {
  // Les parties de ce fichier : celles où un siège est lié à l'un de ses comptes.
  await pool.query(
    `DELETE FROM games WHERE id IN (
       SELECT gp.game_id FROM game_players gp
       JOIN users u ON u.id = gp.user_id
       WHERE u.email LIKE '%' || $1)`,
    [DOMAIN]
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
}

let seq = 0;
async function createUser() {
  seq += 1;
  const username = `dela_${process.pid}_${seq}`;
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id, username`,
    [username, `${username}${DOMAIN}`, hash]
  );
  return { ...rows[0], token: signToken({ id: rows[0].id, username }) };
}

let servers = [];
let clients = [];

// Monte un serveur complet (HTTP + WS), comme server.js : enregistrement réel et
// contrôle de la version de token à la connexion.
async function startServer(opts = {}) {
  const server = http.createServer(app);
  const rt = await attachWebSocketServer(server, {
    validateUser: checkTokenVersion,
    tickMs: 15,
    sweepMs: 20,
    graceMs: 60000,
    heartbeatMs: 0,
    ...opts,
  });
  await new Promise(r => server.listen(0, r));
  servers.push({ server, rt });
  return { server, rt, port: server.address().port };
}

async function connect(port, user) {
  const ws = new WebSocket(`ws://localhost:${port}/ws?token=${user.token}`);
  const msgs = [];
  ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  const closed = new Promise(res => ws.once('close', (code) => res(code)));
  ws.on('error', () => {});
  await once(ws, 'open');
  await waitFor(() => msgs.some(m => m.t === 'hello' || m.t === 'error'), 'accueil WebSocket');
  clients.push(ws);
  return { ws, msgs, closed };
}

const deleteAccount = (server, user, currentPassword = PASSWORD) =>
  supertest(server).delete('/api/users/me')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ currentPassword });

const userExists = async (id) =>
  (await pool.query(`SELECT 1 FROM users WHERE id = $1`, [id])).rows.length > 0;

const newRankedSession = (a, b, rated = true) => sessionStore.createSession({
  players: [{ userId: a.id, name: a.username }, { userId: b.id, name: b.username }],
  variant: 'classic', target: 3, rated,
});

before(cleanup);
beforeEach(async () => { const r = useMockRedis(14); await flush(r); await bus.stop(); });
afterEach(async () => {
  for (const ws of clients) { try { ws.terminate(); } catch { /* déjà fermé */ } }
  clients = [];
  for (const { server, rt } of servers) { rt.stop(); server.close(); }
  servers = [];
  await closeRedis();
});
after(async () => { await cleanup(); await pool.end(); });

test('sans token : 401', async () => {
  const { server } = await startServer();
  const res = await supertest(server).delete('/api/users/me').send({ currentPassword: PASSWORD });
  assert.equal(res.status, 401);
});

test('mot de passe absent ou mal typé : 422, compte conservé', async () => {
  const { server } = await startServer();
  const user = await createUser();
  for (const body of [{}, { currentPassword: '' }, { currentPassword: 12345 }, { currentPassword: { a: 1 } }]) {
    const res = await supertest(server).delete('/api/users/me')
      .set('Authorization', `Bearer ${user.token}`).send(body);
    assert.equal(res.status, 422, JSON.stringify(body));
  }
  assert.equal(await userExists(user.id), true);
});

test('mauvais mot de passe : 403, ni suppression, ni forfait, ni déconnexion', async () => {
  const { server, port } = await startServer();
  const [user, opp] = [await createUser(), await createUser()];
  const session = await newRankedSession(user, opp);
  const c = await connect(port, user);

  const res = await deleteAccount(server, user, 'MauvaisMotDePasse1!');
  assert.equal(res.status, 403);
  assert.equal(await userExists(user.id), true);
  assert.equal((await sessionStore.getSession(session.id)).finished, false);
  await delay(50);
  assert.equal(c.ws.readyState, WebSocket.OPEN);
});

test('JWT révoqué par token_version : 401', async () => {
  const { server } = await startServer();
  const user = await createUser();
  await pool.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [user.id]);
  const res = await deleteAccount(server, user);
  assert.equal(res.status, 401);
  assert.equal(await userExists(user.id), true);
});

test('succès : compte effacé, sièges anonymisés, amitiés retirées, session invalide', async () => {
  const { server } = await startServer();
  const [user, friend] = [await createUser(), await createUser()];
  await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`,
    [user.id, friend.id]
  );
  await pool.query(`INSERT INTO user_achievements (user_id, code) VALUES ($1, 'partie-blanche')`, [user.id]);
  const { rows: g } = await pool.query(
    `INSERT INTO games (mode, variant, player_count, target_score, ended_at)
     VALUES ('online', 'classic', 2, 3, NOW()) RETURNING id`
  );
  await pool.query(
    `INSERT INTO game_players (game_id, user_id, seat, score, won)
     VALUES ($1, $2, 0, 3, TRUE), ($1, $3, 1, 1, FALSE)`,
    [g[0].id, user.id, friend.id]
  );

  const res = await deleteAccount(server, user);
  assert.equal(res.status, 200);
  assert.equal(await userExists(user.id), false);

  const { rows: seat } = await pool.query(
    `SELECT user_id, guest_name FROM game_players WHERE game_id = $1 AND seat = 0`, [g[0].id]);
  assert.equal(seat[0].user_id, null);
  assert.equal(seat[0].guest_name, 'Ancien joueur');

  const { rows: fr } = await pool.query(
    `SELECT 1 FROM friendships WHERE requester_id = $1 OR addressee_id = $1`, [user.id]);
  assert.equal(fr.length, 0, 'amitiés retirées');
  const { rows: ach } = await pool.query(`SELECT 1 FROM user_achievements WHERE user_id = $1`, [user.id]);
  assert.equal(ach.length, 0, 'badges retirés');

  const me = await supertest(server).get('/api/users/me').set('Authorization', `Bearer ${user.token}`);
  assert.equal(me.status, 401, 'le JWT est inutilisable');
  const again = await deleteAccount(server, user);
  assert.equal(again.status, 401);
  const login = await supertest(server).post('/api/auth/login').send({ username: user.username, password: PASSWORD });
  assert.equal(login.status, 401);

  // L'adversaire garde son historique, sans le pseudo du joueur supprimé.
  const hist = await supertest(server).get('/api/users/history').set('Authorization', `Bearer ${friend.token}`);
  assert.equal(hist.body.find(h => h.id === g[0].id).opponents, 'Ancien joueur');
});

test('partie classée en cours : forfait, défaite enregistrée, Elo de l’adversaire crédité', async () => {
  const { server, port } = await startServer();
  const [user, opp] = [await createUser(), await createUser()];
  const session = await newRankedSession(user, opp);
  const cUser = await connect(port, user);
  const cOpp = await connect(port, opp);

  const res = await deleteAccount(server, user);
  assert.equal(res.status, 200);

  // L'enregistrement est attendu par la route : le résultat est déjà en base.
  const { rows } = await pool.query(
    `SELECT gp.user_id, gp.guest_name, gp.won, gp.rating_before, gp.rating_after
     FROM game_players gp JOIN game_players gp2 ON gp2.game_id = gp.game_id
     WHERE gp2.user_id = $1 ORDER BY gp.seat`,
    [opp.id]
  );
  assert.equal(rows.length, 2, 'la partie est enregistrée');
  const [deleted, winner] = rows;
  assert.equal(deleted.user_id, null);
  assert.equal(deleted.guest_name, 'Ancien joueur');
  assert.equal(deleted.won, false, 'la défaite est inscrite');
  assert.ok(deleted.rating_after < deleted.rating_before, 'la défaite pèse sur l’Elo');
  assert.equal(winner.user_id, opp.id);
  assert.equal(winner.won, true);

  const { rows: u } = await pool.query(`SELECT rating_classic FROM users WHERE id = $1`, [opp.id]);
  assert.ok(u[0].rating_classic > 1500, 'l’adversaire gagne de l’Elo');

  // Diffusion : état final avant la fermeture, adversaire libéré.
  await waitFor(() => cOpp.msgs.some(m => m.t === 'state' && m.state.finished), 'état final de l’adversaire');
  const final = cOpp.msgs.filter(m => m.t === 'state').pop();
  assert.equal(final.state.matchResult.forfeit.by, 0);
  assert.equal(final.state.matchResult.forfeit.reason, 'abandon');
  assert.equal(final.state.matchResult.winnerSeat, 1);
  assert.equal(await sessionStore.sessionIdForUser(opp.id), null);
  assert.equal(await sessionStore.getSession(session.id), null);

  // Le socket est fermé définitivement, sans délai de grâce qui traîne.
  assert.equal(await cUser.closed, 4003);
  await waitFor(async () => !(await presenceStore.isOnline(user.id)), 'présence retirée');
  assert.equal(await presenceStore.getGrace(user.id), null);
  assert.ok(!cOpp.msgs.some(m => m.t === 'opponentDisconnected'), 'pas d’alerte de déconnexion parasite');
  assert.equal(cOpp.ws.readyState, WebSocket.OPEN, 'l’adversaire reste connecté');
});

test('la suppression attend l’enregistrement du match, même lent', async () => {
  // Sans cette attente, le compte disparaîtrait avant le calcul de l'Elo.
  const { server } = await startServer({
    onMatchComplete: async (outcome) => { await delay(150); return recordMatch(outcome); },
  });
  const [user, opp] = [await createUser(), await createUser()];
  await newRankedSession(user, opp);

  assert.equal((await deleteAccount(server, user)).status, 200);

  const { rows } = await pool.query(`SELECT rating_classic FROM users WHERE id = $1`, [opp.id]);
  assert.ok(rows[0].rating_classic > 1500, 'Elo crédité avant la réponse');
});

test('partie amicale en cours : forfait sans mouvement d’Elo', async () => {
  const { server, port } = await startServer();
  const [user, opp] = [await createUser(), await createUser()];
  await newRankedSession(user, opp, false);
  const cOpp = await connect(port, opp);

  assert.equal((await deleteAccount(server, user)).status, 200);

  await waitFor(() => cOpp.msgs.some(m => m.t === 'state' && m.state.finished), 'état final');
  const { rows } = await pool.query(`SELECT rating_classic FROM users WHERE id = $1`, [opp.id]);
  assert.equal(rows[0].rating_classic, 1500);
  assert.equal(await sessionStore.sessionIdForUser(opp.id), null);
});

test('en file d’attente : le joueur en sort et ses sockets, tous onglets, sont fermés', async () => {
  const { server, port } = await startServer();
  const user = await createUser();
  const tab1 = await connect(port, user);
  const tab2 = await connect(port, user);
  tab1.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await waitFor(() => matchmakingStore.has(user.id), 'entrée en file');

  assert.equal((await deleteAccount(server, user)).status, 200);

  assert.equal(await matchmakingStore.has(user.id), false);
  assert.equal(await matchmakingStore.totalSize(), 0);
  assert.equal(await tab1.closed, 4003);
  assert.equal(await tab2.closed, 4003);
});

test('un ancien JWT ne rouvre pas de WebSocket après suppression', async () => {
  const { server, port } = await startServer();
  const user = await createUser();
  assert.equal((await deleteAccount(server, user)).status, 200);

  const ws = new WebSocket(`ws://localhost:${port}/ws?token=${user.token}`);
  clients.push(ws);
  ws.on('error', () => {});
  assert.equal(await once(ws, 'close'), 4001);
});

test('défis envoyés et reçus : annulés, et les autres joueurs sont prévenus', async () => {
  const { server, port } = await startServer();
  const [user, target, challenger] = [await createUser(), await createUser(), await createUser()];
  await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status)
     VALUES ($1, $2, 'accepted'), ($3, $1, 'accepted')`,
    [user.id, target.id, challenger.id]
  );
  const cUser = await connect(port, user);
  const cTarget = await connect(port, target);
  const cChallenger = await connect(port, challenger);
  cUser.ws.send(JSON.stringify({ t: 'challenge', action: 'invite', to: target.id, variant: 'classic' }));
  await waitFor(() => cTarget.msgs.some(m => m.kind === 'challenge'), 'défi envoyé');
  cChallenger.ws.send(JSON.stringify({ t: 'challenge', action: 'invite', to: user.id, variant: 'classic' }));
  await waitFor(() => cUser.msgs.some(m => m.kind === 'challenge'), 'défi reçu');

  assert.equal((await deleteAccount(server, user)).status, 200);

  await waitFor(() => cTarget.msgs.some(m => m.kind === 'challengeCancelled'), 'annulation du défi envoyé');
  await waitFor(() => cChallenger.msgs.some(m => m.t === 'challenge' && m.status === 'cancelled'), 'annulation du défi reçu');
  assert.equal(await cUser.closed, 4003);
});

test('multi-instance : un socket ouvert sur une autre instance est fermé', async () => {
  const a = await startServer();
  const b = await startServer(); // b traite la requête, le socket vit sur a
  const user = await createUser();
  const c = await connect(a.port, user);

  assert.equal((await deleteAccount(b.server, user)).status, 200);
  assert.equal(await c.closed, 4003);
});

test('échec de la suppression en base : erreur propagée, joueur non déconnecté, marqueur levé', async () => {
  const { port } = await startServer();
  const user = await createUser();
  const c = await connect(port, user);

  await assert.rejects(
    accountRemoval.removeAccount(user.id, async () => { throw new Error('panne'); }),
    /panne/
  );
  await delay(50);
  assert.equal(c.ws.readyState, WebSocket.OPEN, 'le socket reste ouvert');
  assert.equal(await userExists(user.id), true);

  // Le marqueur levé, le joueur peut de nouveau rejoindre la file.
  c.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await waitFor(() => matchmakingStore.has(user.id), 'retour en file');
});

test('pendant la suppression : file et défis refusés, nouvelle connexion rejetée', async () => {
  const { port } = await startServer();
  const [user, friend] = [await createUser(), await createUser()];
  const c = await connect(port, user);

  let release;
  const held = new Promise(res => { release = res; });
  let entered;
  const inDelete = new Promise(res => { entered = res; });
  const removal = accountRemoval.removeAccount(user.id, async () => { entered(); await held; });
  await inDelete;

  c.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  c.ws.send(JSON.stringify({ t: 'challenge', action: 'invite', to: friend.id, variant: 'classic' }));
  await waitFor(() => c.msgs.filter(m => m.error === 'Compte en cours de suppression.').length === 2, 'refus');
  assert.equal(await matchmakingStore.has(user.id), false);

  const late = new WebSocket(`ws://localhost:${port}/ws?token=${user.token}`);
  clients.push(late);
  late.on('error', () => {});
  assert.equal(await once(late, 'close'), 4001);

  release();
  await removal;
});

test('sans serveur temps réel : la suppression échoue plutôt que d’éviter le forfait', async () => {
  const user = await createUser();
  const res = await deleteAccount(app, user);
  assert.equal(res.status, 500);
  assert.equal(await userExists(user.id), true);
});

test('recordMatch : un compte déjà supprimé n’annule pas l’enregistrement du match', async () => {
  const [gone, opp] = [await createUser(), await createUser()];
  await pool.query(`DELETE FROM users WHERE id = $1`, [gone.id]);

  const res = await recordMatch({
    variant: 'classic', target: 3, rated: true,
    players: [
      { userId: gone.id, name: gone.username, seat: 0, score: 3, won: true, facts: { chouine: true } },
      { userId: opp.id, name: opp.username, seat: 1, score: 0, won: false, facts: { chouine: false } },
    ],
  });
  assert.ok(res.gameId);
  assert.equal(res.ratings, null, 'pas d’Elo sans les deux comptes');

  const { rows } = await pool.query(
    `SELECT user_id, guest_name, rating_after FROM game_players WHERE game_id = $1 ORDER BY seat`, [res.gameId]);
  assert.equal(rows[0].user_id, null);
  assert.equal(rows[0].guest_name, 'Ancien joueur');
  assert.equal(rows[1].user_id, opp.id);
});
