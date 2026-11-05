'use strict';

// Lien d'invitation (#295) : inscription, effet à la vérification de l'email et
// suppressions de comptes. Tests d'intégration sur la vraie base : les contraintes
// et les transactions font partie de ce qui est vérifié.

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');

const { useMockRedis, closeRedis } = require('./helpers/redis');
const { pool } = require('../src/db');
const app = require('../src/app');
const config = require('../src/config');
// Ce fichier crée une trentaine de comptes : au coût bcrypt de production, il
// prendrait le processeur aux tests WebSocket sensibles au temps, lancés en parallèle.
config.auth.bcryptRounds = 4;
const invitations = require('../src/services/invitations');
const { signToken } = require('../src/middleware/auth');

const request = supertest(app);

// Domaine propre au fichier : les tests tournent en parallèle sur la même base.
const DOMAIN = '@invitations.invalid';
const PASSWORD = 'Motdepasse123!';
const hash = bcrypt.hashSync(PASSWORD, 4);
const UNKNOWN_CODE = 'f'.repeat(32);

async function cleanup() {
  await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
}

let seq = 0;
const nextName = () => `inv_${process.pid}_${++seq}`;

// Compte déjà vérifié, avec son code d'invitation obtenu par la route.
async function createInviter() {
  const username = nextName();
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id, username`,
    [username, `${username}${DOMAIN}`, hash]
  );
  const token = signToken({ id: rows[0].id, username });
  const res = await request.get('/api/users/me/invitation').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const code = res.body.url.split('/').pop();
  return { ...rows[0], token, code };
}

async function register(invitationCode) {
  const username = nextName();
  const res = await request.post('/api/auth/register').send({
    username,
    email: `${username}${DOMAIN}`,
    password: PASSWORD,
    invitationCode,
  });
  assert.equal(res.status, 201);
  const { rows } = await pool.query(
    `SELECT id, username, invited_by FROM users WHERE username = $1`,
    [username]
  );
  return { ...rows[0], body: res.body };
}

// Le token n'est stocké que haché et l'email n'est pas relevé ici : on en pose un connu.
async function setVerifyToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `UPDATE users SET verify_token = $1, verify_expires = NOW() + INTERVAL '1 hour' WHERE id = $2`,
    [crypto.createHash('sha256').update(token).digest('hex'), userId]
  );
  return token;
}

const verify = (token) => request.get('/api/auth/verify-email').query({ token });

async function friendships(a, b) {
  const { rows } = await pool.query(
    `SELECT requester_id, addressee_id, status FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [a, b]
  );
  return rows;
}

async function hasBadge(userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM user_achievements WHERE user_id = $1 AND code = 'ambassadeur'`,
    [userId]
  );
  return rows.length === 1;
}

async function isVerified(userId) {
  const { rows } = await pool.query(`SELECT email_verified FROM users WHERE id = $1`, [userId]);
  return rows[0].email_verified;
}

before(() => { useMockRedis(15); });
beforeEach(cleanup);
after(async () => {
  await cleanup();
  await pool.end();
  await closeRedis();
});

// ─── Lien ─────────────────────────────────────────────────────────────────────

test('le lien repose sur un code aléatoire stable, sans donnée du compte', async () => {
  const inviter = await createInviter();
  const res = await request.get('/api/users/me/invitation').set('Authorization', `Bearer ${inviter.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.url, `${config.frontend.url}/invitation/${inviter.code}`);
  assert.equal(res.body.invitedCount, 0);
  assert.match(inviter.code, /^[0-9a-f]{32}$/);
  assert.ok(!res.body.url.includes(inviter.id));
  assert.ok(!res.body.url.includes(inviter.username));

  const other = await createInviter();
  assert.notEqual(other.code, inviter.code);
});

test('le lien personnel exige une session', async () => {
  const res = await request.get('/api/users/me/invitation');
  assert.equal(res.status, 401);
});

test('deux demandes simultanées donnent le même code', async () => {
  const inviter = await createInviter();
  await pool.query(`UPDATE users SET invite_code = NULL WHERE id = $1`, [inviter.id]);
  const responses = await Promise.all(Array.from({ length: 5 }, () =>
    request.get('/api/users/me/invitation').set('Authorization', `Bearer ${inviter.token}`)
  ));
  assert.equal(new Set(responses.map(r => r.body.url)).size, 1);
});

// ─── Résolution publique ──────────────────────────────────────────────────────

test('la résolution ne renvoie que le pseudo', async () => {
  const inviter = await createInviter();
  const res = await request.get(`/api/invitations/${inviter.code}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { username: inviter.username });
});

test('la résolution répond 404 de la même façon à un code inconnu ou mal formé', async () => {
  const unknown = await request.get(`/api/invitations/${UNKNOWN_CODE}`);
  const malformed = await request.get(`/api/invitations/${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(unknown.status, 404);
  assert.equal(malformed.status, 404);
  assert.deepEqual(unknown.body, malformed.body);
});

test('un compte non vérifié ne peut pas inviter', async () => {
  const inviter = await createInviter();
  await pool.query(`UPDATE users SET email_verified = FALSE WHERE id = $1`, [inviter.id]);
  const res = await request.get(`/api/invitations/${inviter.code}`);
  assert.equal(res.status, 404);
  const invitee = await register(inviter.code);
  assert.equal(invitee.invited_by, null);
});

// ─── Inscription ──────────────────────────────────────────────────────────────

test('inscription avec un code valide : invitation conservée, réponse inchangée', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);
  assert.equal(invitee.invited_by, inviter.id);
  assert.equal(invitee.body.message, 'Compte créé. Un email de confirmation a été envoyé à votre adresse.');
});

test('inscription avec un code invalide : réussit à l’identique, sans invitation', async () => {
  const absent = await register(undefined);
  assert.equal(absent.invited_by, null);

  for (const bad of [UNKNOWN_CODE, 'court', 42, { $ne: null }, ['a'], null]) {
    const invitee = await register(bad);
    assert.equal(invitee.invited_by, null);
    assert.deepEqual(invitee.body, absent.body);
  }
});

test('le champ-piège garde sa priorité sur le code d’invitation', async () => {
  const inviter = await createInviter();
  const username = nextName();
  const res = await request.post('/api/auth/register').send({
    username,
    email: `${username}${DOMAIN}`,
    password: PASSWORD,
    website: 'http://spam.example',
    invitationCode: inviter.code,
  });
  assert.equal(res.status, 201);
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE username = $1`, [username]);
  assert.equal(rows.length, 0);
});

// ─── Vérification de l'email ──────────────────────────────────────────────────

test('rien ne se passe avant la vérification', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);
  assert.deepEqual(await friendships(inviter.id, invitee.id), []);
  assert.equal(await hasBadge(inviter.id), false);

  const res = await request.get('/api/users/me/invitation').set('Authorization', `Bearer ${inviter.token}`);
  assert.equal(res.body.invitedCount, 0);
});

test('un lien de vérification expiré n’applique rien', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);
  const token = await setVerifyToken(invitee.id);
  await pool.query(`UPDATE users SET verify_expires = NOW() - INTERVAL '1 minute' WHERE id = $1`, [invitee.id]);

  assert.equal((await verify(token)).status, 400);
  assert.deepEqual(await friendships(inviter.id, invitee.id), []);
  assert.equal(await hasBadge(inviter.id), false);
});

test('la vérification crée l’amitié acceptée et le badge', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);

  assert.equal((await verify(await setVerifyToken(invitee.id))).status, 200);

  assert.deepEqual(await friendships(inviter.id, invitee.id), [
    { requester_id: inviter.id, addressee_id: invitee.id, status: 'accepted' },
  ]);
  assert.equal(await hasBadge(inviter.id), true);
  assert.equal(await hasBadge(invitee.id), false);

  const list = await request.get('/api/friends').set('Authorization', `Bearer ${inviter.token}`);
  assert.deepEqual(list.body.map(f => f.username), [invitee.username]);

  const me = await request.get('/api/users/me').set('Authorization', `Bearer ${inviter.token}`);
  assert.ok(me.body.achievements.some(a => a.code === 'ambassadeur'));

  const link = await request.get('/api/users/me/invitation').set('Authorization', `Bearer ${inviter.token}`);
  assert.equal(link.body.invitedCount, 1);
});

test('un nouveau lien de vérification conserve l’invitation', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);

  const res = await request.post('/api/auth/forgot-password').send({ email: `${invitee.username}${DOMAIN}` });
  assert.equal(res.status, 200);
  const { rows } = await pool.query(`SELECT invited_by FROM users WHERE id = $1`, [invitee.id]);
  assert.equal(rows[0].invited_by, inviter.id);

  assert.equal((await verify(await setVerifyToken(invitee.id))).status, 200);
  assert.equal(await hasBadge(inviter.id), true);
});

test('un second clic ne refait rien, même après le retrait de l’ami', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);
  const token = await setVerifyToken(invitee.id);

  assert.equal((await verify(token)).status, 200);
  const { rows: [badge] } = await pool.query(
    `SELECT unlocked_at FROM user_achievements WHERE user_id = $1 AND code = 'ambassadeur'`,
    [inviter.id]
  );
  await request.delete(`/api/friends/${invitee.id}`).set('Authorization', `Bearer ${inviter.token}`);

  assert.equal((await verify(token)).status, 400);
  assert.deepEqual(await friendships(inviter.id, invitee.id), [], 'amitié non recréée');
  const { rows } = await pool.query(
    `SELECT unlocked_at FROM user_achievements WHERE user_id = $1 AND code = 'ambassadeur'`,
    [inviter.id]
  );
  assert.deepEqual(rows, [badge]);
});

test('deux clics simultanés n’appliquent l’invitation qu’une fois', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);
  const token = await setVerifyToken(invitee.id);

  const statuses = (await Promise.all([verify(token), verify(token)])).map(r => r.status).sort();
  assert.deepEqual(statuses, [200, 400]);
  assert.equal((await friendships(inviter.id, invitee.id)).length, 1);
});

test('plusieurs invités n’accordent qu’un seul badge', async () => {
  const inviter = await createInviter();
  for (let i = 0; i < 2; i += 1) {
    const invitee = await register(inviter.code);
    assert.equal((await verify(await setVerifyToken(invitee.id))).status, 200);
  }
  const { rows } = await pool.query(
    `SELECT code FROM user_achievements WHERE user_id = $1`,
    [inviter.id]
  );
  assert.deepEqual(rows, [{ code: 'ambassadeur' }]);
});

for (const [label, direction, status, expected] of [
  ['demande de l’invitant en attente', 'inviter', 'pending', 'accepted'],
  ['demande de l’invité en attente', 'invitee', 'pending', 'accepted'],
  ['demande refusée', 'inviter', 'declined', 'accepted'],
  ['amitié déjà acceptée', 'invitee', 'accepted', 'accepted'],
  ['blocage', 'invitee', 'blocked', 'blocked'],
]) {
  test(`relation existante (${label}) : une seule ligne, statut ${expected}`, async () => {
    const inviter = await createInviter();
    const invitee = await register(inviter.code);
    const [requester, addressee] = direction === 'inviter'
      ? [inviter.id, invitee.id]
      : [invitee.id, inviter.id];
    await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, $3)`,
      [requester, addressee, status]
    );

    assert.equal((await verify(await setVerifyToken(invitee.id))).status, 200);

    assert.deepEqual(await friendships(inviter.id, invitee.id), [
      { requester_id: requester, addressee_id: addressee, status: expected },
    ]);
    assert.equal(await hasBadge(inviter.id), true);
  });
}

test('un échec de l’attribution ne bloque pas la vérification et n’expose aucune donnée', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);
  const token = await setVerifyToken(invitee.id);

  // Une écriture suivie d'une erreur SQL : la transaction doit survivre, sans l'écriture.
  const failing = mock.method(invitations, 'grantInvitation', async (client, inviterId, inviteeId) => {
    await client.query(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`,
      [inviterId, inviteeId]
    );
    await client.query('SELECT 1 / 0');
  });
  const logged = [];
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE users SET email_verified = TRUE WHERE id = $1`, [invitee.id]);
      await invitations.applyInvitation(client, { id: invitee.id, invited_by: inviter.id }, {
        error: (...args) => logged.push(args),
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0][0], { code: '22012' });
    assert.ok(!JSON.stringify(logged).includes(inviter.id));
    assert.ok(!JSON.stringify(logged).includes(invitee.id));

    assert.equal((await verify(token)).status, 200);
  } finally {
    failing.mock.restore();
  }

  assert.equal(await isVerified(invitee.id), true);
  assert.deepEqual(await friendships(inviter.id, invitee.id), []);
  assert.equal(await hasBadge(inviter.id), false);
});

// ─── Auto-invitation ──────────────────────────────────────────────────────────

test('on ne peut pas s’inviter soi-même', async () => {
  const inviter = await createInviter();

  await assert.rejects(
    pool.query(`UPDATE users SET invited_by = id WHERE id = $1`, [inviter.id]),
    { code: '23514' }
  );

  const res = await request.post('/api/friends/request')
    .set('Authorization', `Bearer ${inviter.token}`)
    .send({ inviteCode: inviter.code });
  assert.equal(res.status, 422);
  assert.equal(await hasBadge(inviter.id), false);
});

// ─── Suppressions de comptes ──────────────────────────────────────────────────

test('invitant supprimé avant la vérification : le compte de l’invité reste vérifiable', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);
  await pool.query(`DELETE FROM users WHERE id = $1`, [inviter.id]);

  const { rows } = await pool.query(`SELECT invited_by FROM users WHERE id = $1`, [invitee.id]);
  assert.equal(rows[0].invited_by, null);

  assert.equal((await verify(await setVerifyToken(invitee.id))).status, 200);
  assert.equal(await isVerified(invitee.id), true);
});

test('invitant supprimé pendant l’inscription : le compte est créé sans invitation', async () => {
  const inviter = await createInviter();
  const username = nextName();
  const deleter = await pool.connect();
  let released = false;
  try {
    await deleter.query('BEGIN');
    await deleter.query(`DELETE FROM users WHERE id = $1`, [inviter.id]);

    // L'INSERT voit encore l'invitant, puis attend le verrou posé par la suppression.
    const pending = request.post('/api/auth/register').send({
      username,
      email: `${username}${DOMAIN}`,
      password: PASSWORD,
      invitationCode: inviter.code,
    }).then(res => res);

    for (let i = 0; i < 500; i += 1) {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND datname = current_database()
           AND query LIKE 'INSERT INTO users%' AND query LIKE '%invited_by%'`
      );
      if (rows.length) break;
      await new Promise(r => setTimeout(r, 10));
    }
    await deleter.query('COMMIT');
    released = true;

    const res = await pending;
    assert.equal(res.status, 201);
  } finally {
    if (!released) await deleter.query('ROLLBACK');
    deleter.release();
  }
  const { rows } = await pool.query(`SELECT invited_by FROM users WHERE username = $1`, [username]);
  assert.equal(rows[0].invited_by, null);
});

test('invité supprimé avant la vérification : aucun effet pour l’invitant', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);
  const token = await setVerifyToken(invitee.id);
  await pool.query(`DELETE FROM users WHERE id = $1`, [invitee.id]);

  assert.equal((await verify(token)).status, 400);
  assert.equal(await hasBadge(inviter.id), false);
});

test('invité supprimé après la vérification : l’amitié part, le badge reste, l’invitant reste', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);
  assert.equal((await verify(await setVerifyToken(invitee.id))).status, 200);

  await pool.query(`DELETE FROM users WHERE id = $1`, [invitee.id]);

  assert.deepEqual(await friendships(inviter.id, invitee.id), []);
  assert.equal(await hasBadge(inviter.id), true);
  const res = await request.get('/api/users/me/invitation').set('Authorization', `Bearer ${inviter.token}`);
  assert.equal(res.body.invitedCount, 0);
});

test('invitant supprimé après la vérification : le compte de l’invité reste intact', async () => {
  const inviter = await createInviter();
  const invitee = await register(inviter.code);
  assert.equal((await verify(await setVerifyToken(invitee.id))).status, 200);

  await pool.query(`DELETE FROM users WHERE id = $1`, [inviter.id]);

  const { rows } = await pool.query(
    `SELECT email_verified, invited_by FROM users WHERE id = $1`,
    [invitee.id]
  );
  assert.deepEqual(rows[0], { email_verified: true, invited_by: null });
});

// ─── Joueur déjà connecté ─────────────────────────────────────────────────────

test('un joueur connecté envoie une demande depuis le lien, sans badge', async () => {
  const inviter = await createInviter();
  const visitor = await createInviter();

  const res = await request.post('/api/friends/request')
    .set('Authorization', `Bearer ${visitor.token}`)
    .send({ inviteCode: inviter.code });
  assert.equal(res.status, 201);

  assert.deepEqual(await friendships(inviter.id, visitor.id), [
    { requester_id: visitor.id, addressee_id: inviter.id, status: 'pending' },
  ]);
  assert.equal(await hasBadge(inviter.id), false);

  const again = await request.post('/api/friends/request')
    .set('Authorization', `Bearer ${visitor.token}`)
    .send({ inviteCode: inviter.code });
  assert.equal(again.status, 409);
});

test('une demande avec un code invalide répond 404', async () => {
  const visitor = await createInviter();
  for (const inviteCode of [UNKNOWN_CODE, 'court', 42, null]) {
    const res = await request.post('/api/friends/request')
      .set('Authorization', `Bearer ${visitor.token}`)
      .send({ inviteCode });
    assert.equal(res.status, 404);
  }
});

test('la route de demande d’ami exige toujours une session', async () => {
  const inviter = await createInviter();
  const res = await request.post('/api/friends/request').send({ inviteCode: inviter.code });
  assert.equal(res.status, 401);
});
