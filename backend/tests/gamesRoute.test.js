'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { signToken } = require('../src/middleware/auth');
const app = require('../src/app');

const request = supertest(app);
// Domaine dédié à ce fichier : les tests tournent en parallèle sur la même
// base, ne jamais matcher le motif de purge d'un autre fichier.
const DOMAIN = '@gamesroute.invalid';

let alice;     // { id, token }
let bobId;     // victime potentielle (#116) — un autre vrai utilisateur

// Supprime les parties des utilisateurs de test PUIS les utilisateurs : la FK
// game_players.user_id est ON DELETE SET NULL, et un siège (user_id NULL,
// guest_name NULL) violerait la contrainte must_have_identity (défaut de
// schéma tracké à part — toute suppression d'un utilisateur ayant des parties
// déclencherait la même erreur).
async function cleanup() {
  await pool.query(
    `DELETE FROM games WHERE id IN (
       SELECT gp.game_id FROM game_players gp
       JOIN users u ON u.id = gp.user_id
       WHERE u.email LIKE '%' || $1
     )`,
    [DOMAIN]
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
}

before(async () => {
  await cleanup();
  const hash = await bcrypt.hash('Motdepasse123!', 12);
  const ins = async (name) => (await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id, username, rating_classic`,
    [name, `${name.toLowerCase()}${DOMAIN}`, hash]
  )).rows[0];
  const a = await ins('GamesAlice');
  const b = await ins('GamesBob');
  alice = { id: a.id, token: signToken({ id: a.id, username: a.username }) };
  bobId = b.id;
});

after(async () => {
  await cleanup();
  await pool.end();
});

const basePayload = (over = {}) => ({
  mode: 'ai',
  variant: 'classic',
  playerCount: 2,
  targetScore: 3,
  players: [
    { userId: null, guestName: null, score: 3, won: true },
    { userId: null, guestName: 'Ordinateur', score: 1, won: false },
  ],
  ...over,
});

test('POST /api/games — mode online refusé (#116) : l’Elo ne se déclare pas côté client', async () => {
  const res = await request.post('/api/games')
    .set('Authorization', `Bearer ${alice.token}`)
    .send(basePayload({
      mode: 'online',
      players: [
        { userId: alice.id, guestName: null, score: 3, won: true },
        { userId: bobId, guestName: null, score: 0, won: false },
      ],
    }));
  assert.equal(res.status, 422);

  // L'Elo de Bob n'a pas bougé.
  const { rows } = await pool.query(`SELECT rating_classic FROM users WHERE id = $1`, [bobId]);
  assert.equal(Number(rows[0].rating_classic), 1500);
});

test('POST /api/games — un tiers référencé est rétrogradé en invité (#116)', async () => {
  const res = await request.post('/api/games')
    .set('Authorization', `Bearer ${alice.token}`)
    .send(basePayload({
      players: [
        { userId: alice.id, guestName: null, score: 3, won: true },
        { userId: bobId, guestName: null, score: 1, won: false }, // usurpation tentée
      ],
    }));
  assert.equal(res.status, 201);

  const { rows } = await pool.query(
    `SELECT user_id, guest_name, won FROM game_players WHERE game_id = $1 ORDER BY seat`,
    [res.body.id]
  );
  assert.equal(rows[0].user_id, alice.id, 'l’appelant est rattaché');
  assert.equal(rows[1].user_id, null, 'le tiers n’est PAS rattaché');
  assert.ok(rows[1].guest_name, 'le siège du tiers devient un invité');
});

test('POST /api/games — partie IA légitime enregistrée', async () => {
  const res = await request.post('/api/games')
    .set('Authorization', `Bearer ${alice.token}`)
    .send(basePayload({
      players: [
        { userId: alice.id, guestName: null, score: 3, won: true },
        { userId: null, guestName: 'Ordinateur', score: 0, won: false },
      ],
    }));
  assert.equal(res.status, 201);
  assert.ok(res.body.id);
});

// ─── Validation (#225) ────────────────────────────────────────────────────────

const post = (body) => request.post('/api/games')
  .set('Authorization', `Bearer ${alice.token}`)
  .send(body);

const seat = (over = {}) => ({ userId: null, guestName: 'Invité', score: 0, won: false, ...over });
const aliceSeat = (over = {}) => ({ userId: alice.id, guestName: null, score: 3, won: true, ...over });

const countAliceGames = async () => Number((await pool.query(
  `SELECT COUNT(*) AS n FROM game_players WHERE user_id = $1`, [alice.id]
)).rows[0].n);

// Chaque cas : [libellé, champs surchargés, extrait attendu du message d'erreur].
const refused = () => [
  ['plus de sièges que playerCount', { playerCount: 2, players: [aliceSeat(), seat(), seat()] }, 'nombre de joueurs'],
  ['moins de sièges que playerCount', { playerCount: 4, players: [aliceSeat(), seat(), seat()] }, 'nombre de joueurs'],
  ['plus de 4 sièges', { playerCount: 4, players: [aliceSeat(), seat(), seat(), seat(), seat()] }, 'nombre de joueurs'],
  ['guestName de 31 caractères', { players: [aliceSeat(), seat({ guestName: 'x'.repeat(31) })] }, 'nom trop long'],
  ['guestName de 31 emojis', { players: [aliceSeat(), seat({ guestName: '🂡'.repeat(31) })] }, 'nom trop long'],
  ['guestName non textuel', { players: [aliceSeat(), seat({ guestName: { a: 'x'.repeat(40) } })] }, 'nom invalide'],
  ['guestName avec caractère nul', { players: [aliceSeat(), seat({ guestName: 'a\u0000b' })] }, 'nom invalide'],
  ['score hors SMALLINT', { players: [aliceSeat(), seat({ score: 70000 })] }, 'score invalide'],
  ['score négatif', { players: [aliceSeat(), seat({ score: -1 })] }, 'score invalide'],
  ['score décimal', { players: [aliceSeat(), seat({ score: 1.5 })] }, 'score invalide'],
  ['score non numérique', { players: [aliceSeat(), seat({ score: 'abc' })] }, 'score invalide'],
  ['score numérique en texte', { players: [aliceSeat(), seat({ score: '1' })] }, 'score invalide'],
  ['score supérieur à l’objectif', { targetScore: 3, players: [aliceSeat({ score: 4 }), seat()] }, 'score invalide'],
  ['difficulté inconnue', { difficulty: 'impossible' }, 'Difficulté invalide'],
  ['difficulté vide', { difficulty: '' }, 'Difficulté invalide'],
  ['difficulté non textuelle', { difficulty: ['easy'] }, 'Difficulté invalide'],
  ['siège null', { players: [aliceSeat(), null] }, 'siège invalide'],
  ['siège primitif', { players: [aliceSeat(), 42] }, 'siège invalide'],
  ['siège tableau', { players: [aliceSeat(), []] }, 'siège invalide'],
];

test('POST /api/games — entrées invalides : 400 explicite, rien n’est enregistré (#225)', async () => {
  const before = await countAliceGames();
  for (const [label, over, message] of refused()) {
    const res = await post(basePayload({ players: [aliceSeat(), seat()], ...over }));
    assert.equal(res.status, 400, label);
    assert.ok(res.body.error.includes(message), `${label} : ${res.body.error}`);
  }
  assert.equal(await countAliceGames(), before);
});

test('POST /api/games — corps absent ou non-objet : jamais de 500 (#225)', async () => {
  const raw = (body) => request.post('/api/games')
    .set('Authorization', `Bearer ${alice.token}`)
    .set('Content-Type', 'application/json')
    .send(body);

  assert.equal((await request.post('/api/games').set('Authorization', `Bearer ${alice.token}`)).status, 422);
  assert.equal((await raw('[]')).status, 422);
  assert.equal((await raw('null')).status, 400);
  assert.equal((await raw('42')).status, 400);
  assert.equal((await raw('{"mode":')).status, 400);
  assert.equal((await raw(JSON.stringify({ pad: 'x'.repeat(70 * 1024) }))).status, 413);
});

test('POST /api/games — valeurs limites acceptées (#225)', async () => {
  const name30 = '🂡'.repeat(30); // 30 caractères, mais 60 unités UTF-16
  const res = await post(basePayload({
    targetScore: 5,
    difficulty: null,
    players: [aliceSeat({ score: 5 }), seat({ guestName: name30, score: null, won: null })],
  }));
  assert.equal(res.status, 201);

  const { rows } = await pool.query(
    `SELECT guest_name, score, won FROM game_players WHERE game_id = $1 ORDER BY seat`,
    [res.body.id]
  );
  assert.equal(rows[0].score, 5);
  assert.equal(rows[1].guest_name, name30);
  assert.equal(rows[1].score, null);
  assert.equal(rows[1].won, null);
});

// Reproduit la construction de `saveMatchResult` (frontend/src/store/gameStore.ts)
// pour chaque configuration que l'écran « Jouer » peut lancer, et vérifie que
// player_count enregistré = nombre réel de sièges.
test('POST /api/games — les requêtes du client sont acceptées, pour chaque variante (#225)', async () => {
  for (const variant of ['classic', 'mondoubleau']) {
    for (const playerCount of [2, 3, 4]) {
      for (const target of [3, 5]) {
        for (const [mode, difficulty] of [['ai', 'easy'], ['ai', 'normal'], ['ai', 'hard'], ['local', 'normal']]) {
          const names = Array.from({ length: playerCount }, (_, i) =>
            mode === 'ai' ? `Ordinateur ${i}` : 'N'.repeat(16));
          const scores = names.map((_, i) => (i === 0 ? target : target - 1));
          const res = await post({
            mode,
            variant,
            playerCount,
            targetScore: target,
            difficulty,
            players: names.map((name, i) => ({
              userId: i === 0 ? alice.id : null,
              guestName: i === 0 ? null : name,
              score: scores[i],
              won: scores[i] >= target,
            })),
          });
          const label = `${variant}/${mode}/${difficulty}/${playerCount}j/${target}`;
          assert.equal(res.status, 201, `${label} : ${res.body.error}`);

          const { rows } = await pool.query(
            `SELECT g.variant, g.player_count, COUNT(gp.id) AS seats
             FROM games g JOIN game_players gp ON gp.game_id = g.id
             WHERE g.id = $1 GROUP BY g.variant, g.player_count`,
            [res.body.id]
          );
          assert.equal(rows[0].variant, variant, label);
          assert.equal(rows[0].player_count, playerCount, label);
          assert.equal(Number(rows[0].seats), playerCount, label);
        }
      }
    }
  }
});

test('POST /api/games — un score valide ne touche jamais à l’Elo, quelle que soit la variante (#116)', async () => {
  const ratings = async () => (await pool.query(
    `SELECT id, rating_classic, rating_mondoubleau FROM users WHERE id = ANY($1) ORDER BY id`,
    [[alice.id, bobId]]
  )).rows;
  const before = await ratings();

  for (const variant of ['classic', 'mondoubleau']) {
    const res = await post(basePayload({
      variant,
      // Champs d'Elo glissés par un client malveillant : ignorés.
      ratingAfter: 3000,
      players: [
        aliceSeat({ rating_after: 3000, ratingAfter: 3000 }),
        { userId: bobId, guestName: null, score: 0, won: false, rating_after: 1 },
      ],
    }));
    assert.equal(res.status, 201, variant);

    const { rows } = await pool.query(
      `SELECT user_id, rating_before, rating_after FROM game_players WHERE game_id = $1 ORDER BY seat`,
      [res.body.id]
    );
    assert.equal(rows[0].rating_before, null);
    assert.equal(rows[0].rating_after, null);
    assert.equal(rows[1].user_id, null, 'le tiers reste un invité');
    assert.equal(rows[1].rating_after, null);
  }

  assert.deepEqual(await ratings(), before);
});
