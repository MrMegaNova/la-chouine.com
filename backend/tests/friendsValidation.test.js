'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { signToken } = require('../src/middleware/auth');
const app = require('../src/app');

const request = supertest(app);
// Domaine email dédié au fichier (isolation des tests parallèles, cf. CLAUDE.md).
const DOMAIN = '@friendsvalidation.invalid';

let alice; // { id, token }
let bob;   // { id, token }

const asAlice = (req) => req.set('Authorization', `Bearer ${alice.token}`);
const asBob = (req) => req.set('Authorization', `Bearer ${bob.token}`);

// Les friendships partent en cascade avec les users ; aucune partie ici.
async function cleanup() {
  await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
}

before(async () => {
  await cleanup();
  const hash = await bcrypt.hash('Motdepasse123!', 12);
  const ins = async (name) => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (username, email, password_hash, email_verified)
       VALUES ($1, $2, $3, TRUE) RETURNING id, username`,
      [name, `${name.toLowerCase()}${DOMAIN}`, hash]
    );
    return { id: u.id, token: signToken({ id: u.id, username: u.username }) };
  };
  alice = await ins('FriendValAlice');
  bob = await ins('FriendValBob');
});

after(async () => {
  await cleanup();
  await pool.end();
});

// Valeurs malformées reçues dans le corps JSON. Le tableau contient un UUID
// valide : il passerait une regex seule, puis casserait le cast Postgres.
const MALFORMED = () => [
  'abc',
  '00000000-0000-0000-0000-00000000000',
  `${bob.id}' OR 1=1 --`,
  123,
  true,
  { id: bob.id },
  [bob.id],
];

test('POST /api/friends/request — identifiant malformé : 422 (pas de 500)', async () => {
  for (const targetId of MALFORMED()) {
    const res = await asAlice(request.post('/api/friends/request')).send({ targetId });
    assert.equal(res.status, 422, `targetId = ${JSON.stringify(targetId)}`);
  }
});

for (const route of ['accept', 'decline']) {
  test(`POST /api/friends/${route} — identifiant malformé : 422 (pas de 500)`, async () => {
    for (const requesterId of MALFORMED()) {
      const res = await asAlice(request.post(`/api/friends/${route}`)).send({ requesterId });
      assert.equal(res.status, 422, `requesterId = ${JSON.stringify(requesterId)}`);
    }
  });
}

for (const route of ['request', 'accept', 'decline']) {
  test(`POST /api/friends/${route} — sans corps : 422 (pas de 500)`, async () => {
    const res = await asAlice(request.post(`/api/friends/${route}`));
    assert.equal(res.status, 422);
  });
}

test('DELETE /api/friends/:id — identifiant malformé : 404 (pas de 500)', async () => {
  for (const id of ['abc', '00000000-0000-0000-0000-00000000000', 'abc%00']) {
    const res = await asAlice(request.delete(`/api/friends/${id}`));
    assert.equal(res.status, 404, `id = ${id}`);
    assert.equal(res.body.error, 'Utilisateur introuvable.');
  }
});

test('Routes amis — UUID valide : parcours demande, acceptation, retrait inchangé', async () => {
  const sent = await asAlice(request.post('/api/friends/request')).send({ targetId: bob.id });
  assert.equal(sent.status, 201);

  const accepted = await asBob(request.post('/api/friends/accept')).send({ requesterId: alice.id });
  assert.equal(accepted.status, 200);

  const removed = await asAlice(request.delete(`/api/friends/${bob.id}`));
  assert.equal(removed.status, 200);

  const { rows } = await pool.query(
    `SELECT 1 FROM friendships WHERE requester_id = $1 AND addressee_id = $2`,
    [alice.id, bob.id]
  );
  assert.equal(rows.length, 0);
});

test('POST /api/friends/decline — UUID valide : demande refusée', async () => {
  const sent = await asBob(request.post('/api/friends/request')).send({ targetId: alice.id });
  assert.equal(sent.status, 201);

  const declined = await asAlice(request.post('/api/friends/decline')).send({ requesterId: bob.id });
  assert.equal(declined.status, 200);

  const { rows } = await pool.query(
    `SELECT status FROM friendships WHERE requester_id = $1 AND addressee_id = $2`,
    [bob.id, alice.id]
  );
  assert.equal(rows[0].status, 'declined');
});

// ─── Casse des UUID (#278) ────────────────────────────────────────────────────

async function clearFriendships() {
  await pool.query(
    `DELETE FROM friendships WHERE requester_id = ANY($1::uuid[]) OR addressee_id = ANY($1::uuid[])`,
    [[alice.id, bob.id]]
  );
}

test('POST /api/friends/request — son propre UUID : même refus quelle que soit la casse', async () => {
  for (const targetId of [alice.id, alice.id.toUpperCase()]) {
    const res = await asAlice(request.post('/api/friends/request')).send({ targetId });
    assert.equal(res.status, 422, `targetId = ${targetId}`);
    assert.equal(res.body.error, 'Impossible de s\'ajouter soi-même.');
  }
});

test('POST /api/friends/request — UUID en majuscules : acceptation automatique de la demande inverse', async () => {
  await clearFriendships();
  const sent = await asBob(request.post('/api/friends/request')).send({ targetId: alice.id });
  assert.equal(sent.status, 201);

  const res = await asAlice(request.post('/api/friends/request')).send({ targetId: bob.id.toUpperCase() });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Demande acceptée automatiquement.');
});

test('Routes amis — UUID en majuscules : acceptation, retrait et refus', async () => {
  await clearFriendships();
  await asAlice(request.post('/api/friends/request')).send({ targetId: bob.id });
  const accepted = await asBob(request.post('/api/friends/accept')).send({ requesterId: alice.id.toUpperCase() });
  assert.equal(accepted.status, 200);

  const removed = await asAlice(request.delete(`/api/friends/${bob.id.toUpperCase()}`));
  assert.equal(removed.status, 200);
  const { rows: left } = await pool.query(
    `SELECT 1 FROM friendships WHERE requester_id = $1 AND addressee_id = $2`,
    [alice.id, bob.id]
  );
  assert.equal(left.length, 0);

  await asAlice(request.post('/api/friends/request')).send({ targetId: bob.id });
  const declined = await asBob(request.post('/api/friends/decline')).send({ requesterId: alice.id.toUpperCase() });
  assert.equal(declined.status, 200);
  const { rows: [row] } = await pool.query(
    `SELECT status FROM friendships WHERE requester_id = $1 AND addressee_id = $2`,
    [alice.id, bob.id]
  );
  assert.equal(row.status, 'declined');
});
