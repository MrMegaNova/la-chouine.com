'use strict';

// Connexion avec Google, Facebook ou Apple. Les fournisseurs sont simulés :
// `oauth.setFetch` remplace les appels HTTP vers Google, Facebook et Apple.

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';
process.env.GOOGLE_CLIENT_ID = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.FACEBOOK_APP_ID = 'fb-app';
process.env.FACEBOOK_APP_SECRET = 'fb-secret';
process.env.OAUTH_REDIRECT_BASE = 'https://la-chouine.test';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const supertest = require('supertest');
const jwt = require('jsonwebtoken');
const RedisMock = require('ioredis-mock');

const redisClient = require('../src/redis/client');
const { closeRedis } = require('./helpers/redis');
const { pool } = require('../src/db');
const app = require('../src/app');
const oauth = require('../src/services/oauth');
const { signToken } = require('../src/middleware/auth');

const request = supertest(app);

// Domaine propre au fichier : les tests tournent en parallèle sur la même base.
const DOMAIN = '@oauth.invalid';
const tag = () => crypto.randomBytes(4).toString('hex');

async function cleanup() {
  await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
}

// Redis simulé dans le processus : les index de DB du vrai Redis de la CI sont
// tous pris, et ce fichier n'a besoin que de clés à durée de vie courte.
before(() => { redisClient.setClient(new RedisMock()); });
beforeEach(cleanup);
after(async () => {
  await cleanup();
  oauth.setFetch(null);
  await pool.end();
  await closeRedis();
});

// ─── Faux fournisseurs ────────────────────────────────────────────────────────

/** Google : le point d'échange renvoie un id_token pour cette identité. */
function fakeGoogle(identity, seen = {}) {
  oauth.setFetch(async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    seen.body = new URLSearchParams(init.body);
    const now = Math.floor(Date.now() / 1000);
    const idToken = jwt.sign({
      iss: 'https://accounts.google.com', aud: 'google-client', exp: now + 300, iat: now,
      nonce: identity.nonce ?? seen.nonce, ...identity.claims,
    }, 'peu-importe');
    return new Response(JSON.stringify({ id_token: idToken, access_token: 'x' }), { status: 200 });
  });
}

/** Lance la connexion : renvoie le state, le nonce et le cookie du navigateur. */
async function start(provider, query = '') {
  const res = await request.get(`/api/auth/oauth/${provider}${query}`);
  assert.equal(res.status, 302);
  const location = new URL(res.headers.location);
  const cookie = res.headers['set-cookie'].find(c => c.startsWith('chouine_oauth='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=None/);
  return {
    location,
    state: location.searchParams.get('state'),
    nonce: location.searchParams.get('nonce'),
    cookie: cookie.split(';')[0],
  };
}

/** Retour du fournisseur : renvoie les paramètres de /connexion/retour. */
async function callback(provider, flow, { code = 'code-ok', cookie = flow.cookie, extra = {} } = {}) {
  const q = new URLSearchParams({ state: flow.state, code, ...extra });
  const req = request.get(`/api/auth/oauth/${provider}/callback?${q}`);
  const res = cookie ? await req.set('Cookie', cookie) : await req;
  assert.equal(res.status, 303);
  const location = new URL(res.headers.location, 'https://la-chouine.test');
  assert.equal(location.pathname, '/connexion/retour');
  return Object.fromEntries(location.searchParams);
}

async function googleLogin(claims, opts = {}) {
  const flow = await start('google', opts.query ?? '');
  const seen = { nonce: flow.nonce };
  fakeGoogle({ claims }, seen);
  const result = await callback('google', flow);
  return { flow, result, seen };
}

async function createUser({ verified = true, password = 'x' } = {}) {
  const username = `oa_${tag()}`;
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, $4) RETURNING id, username, email`,
    [username, `${username}${DOMAIN}`, password, verified]
  );
  return rows[0];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('seuls les fournisseurs configurés sont proposés', async () => {
  const res = await request.get('/api/auth/oauth/providers');
  assert.deepEqual(res.body.providers, ['google', 'facebook']);
  const apple = await request.get('/api/auth/oauth/apple');
  assert.equal(apple.status, 303);
  assert.match(apple.headers.location, /erreur=fournisseur/);
});

test('le départ vers Google porte state, nonce, PKCE et l’adresse de retour', async () => {
  const { location } = await start('google');
  assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = location.searchParams;
  assert.equal(q.get('client_id'), 'google-client');
  assert.equal(q.get('redirect_uri'), 'https://la-chouine.test/api/auth/oauth/google/callback');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.ok(q.get('state').length >= 40 && q.get('nonce').length >= 40);
});

test('nouveau joueur Google : choix du pseudo, compte créé et vérifié, sans mot de passe', async () => {
  const email = `neuf_${tag()}${DOMAIN}`;
  const { flow, result, seen } = await googleLogin({ sub: `g-${tag()}`, email, email_verified: true, given_name: 'Hélène' });
  assert.ok(result.inscription, JSON.stringify(result));
  // Le code du fournisseur et le vérificateur PKCE sont envoyés à Google.
  assert.equal(seen.body.get('code'), 'code-ok');
  assert.ok(seen.body.get('code_verifier'));

  const signup = await request.get(`/api/auth/oauth/signup?code=${result.inscription}`).set('Cookie', flow.cookie);
  assert.deepEqual(signup.body, { provider: 'google', suggestion: 'Helene' });

  const username = `oa_${tag()}`;
  const done = await request.post('/api/auth/oauth/complete').set('Cookie', flow.cookie)
    .send({ code: result.inscription, username });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.username, username);
  assert.ok(done.body.token);

  const { rows } = await pool.query(
    `SELECT email_verified, password_hash FROM users WHERE username = $1`, [username]);
  assert.deepEqual(rows[0], { email_verified: true, password_hash: null });

  // Le code d'inscription ne sert qu'une fois.
  const again = await request.post('/api/auth/oauth/complete').set('Cookie', flow.cookie)
    .send({ code: result.inscription, username: `oa_${tag()}` });
  assert.equal(again.status, 400);

  // /users/me indique le fournisseur et l'absence de mot de passe.
  const me = await request.get('/api/users/me').set('Authorization', `Bearer ${done.body.token}`);
  assert.equal(me.body.hasPassword, false);
  assert.deepEqual(me.body.providers, ['google']);

  // La connexion par pseudo échoue (pas de mot de passe), sans erreur serveur.
  const pwd = await request.post('/api/auth/login').send({ username, password: 'nimporte-quoi' });
  assert.equal(pwd.status, 401);
});

test('pseudo refusé : invalide ou déjà pris', async () => {
  const other = await createUser();
  const { flow, result } = await googleLogin({ sub: `g-${tag()}`, email: `p_${tag()}${DOMAIN}`, email_verified: true });
  const post = (username) => request.post('/api/auth/oauth/complete').set('Cookie', flow.cookie)
    .send({ code: result.inscription, username });
  assert.equal((await post('a')).status, 422);
  assert.equal((await post('avec espace')).status, 422);
  assert.equal((await post(other.username.toUpperCase())).status, 409);
});

test('joueur déjà rattaché : connexion directe par code à usage unique', async () => {
  const user = await createUser();
  const sub = `g-${tag()}`;
  await pool.query(`INSERT INTO user_identities (provider, subject, user_id) VALUES ('google', $1, $2)`, [sub, user.id]);

  const { flow, result } = await googleLogin({ sub, email: 'autre@ailleurs.invalid', email_verified: true });
  assert.ok(result.code);
  const res = await request.post('/api/auth/oauth/exchange').set('Cookie', flow.cookie).send({ code: result.code });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, user.id);
  assert.equal(jwt.decode(res.body.token).sub, user.id);
  assert.equal((await request.post('/api/auth/oauth/exchange').set('Cookie', flow.cookie).send({ code: result.code })).status, 400);
});

test('un autre navigateur ne peut pas utiliser le lien de retour', async () => {
  const user = await createUser();
  const sub = `g-${tag()}`;
  await pool.query(`INSERT INTO user_identities (provider, subject, user_id) VALUES ('google', $1, $2)`, [sub, user.id]);

  // Retour du fournisseur sans le cookie, ou avec celui d'un autre navigateur.
  const flow = await start('google');
  fakeGoogle({ claims: { sub, email_verified: true } }, { nonce: flow.nonce });
  assert.deepEqual(await callback('google', flow, { cookie: null }), { erreur: 'etat' });
  const flow2 = await start('google');
  const other = await start('google');
  assert.deepEqual(await callback('google', flow2, { cookie: other.cookie }), { erreur: 'etat' });

  // Code de connexion valide, mais présenté par un autre navigateur.
  const { result } = await googleLogin({ sub, email_verified: true });
  const res = await request.post('/api/auth/oauth/exchange').set('Cookie', other.cookie).send({ code: result.code });
  assert.equal(res.status, 400);
});

test('state inconnu ou rejoué, refus sur la page du fournisseur', async () => {
  const flow = await start('google');
  fakeGoogle({ claims: { sub: `g-${tag()}`, email: `r_${tag()}${DOMAIN}`, email_verified: true } }, { nonce: flow.nonce });
  assert.ok((await callback('google', flow)).inscription);
  assert.deepEqual(await callback('google', flow), { erreur: 'etat' }, 'state à usage unique');

  const denied = await start('google');
  assert.deepEqual(await callback('google', denied, { extra: { error: 'access_denied' } }), { erreur: 'annule' });
});

test('id_token refusé : mauvais destinataire ou mauvais nonce', async () => {
  const flow = await start('google');
  fakeGoogle({ claims: { sub: 'g', aud: 'quelquun-dautre' } }, { nonce: flow.nonce });
  assert.deepEqual(await callback('google', flow), { erreur: 'fournisseur' });

  const flow2 = await start('google');
  fakeGoogle({ nonce: 'faux', claims: { sub: 'g' } });
  assert.deepEqual(await callback('google', flow2), { erreur: 'fournisseur' });
});

test('adresse Google confirmée d’un compte existant : rattachement', async () => {
  const user = await createUser();
  const { flow, result } = await googleLogin({ sub: `g-${tag()}`, email: user.email.toUpperCase(), email_verified: true });
  const res = await request.post('/api/auth/oauth/exchange').set('Cookie', flow.cookie).send({ code: result.code });
  assert.equal(res.body.id, user.id);
  const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
  assert.equal(rows[0].password_hash, 'x', 'le mot de passe d’un compte activé est gardé');
});

test('compte jamais activé : rattaché, mais son mot de passe est effacé et ses sessions révoquées', async () => {
  const user = await createUser({ verified: false, password: 'choisi-par-un-autre' });
  const before = await pool.query(`SELECT token_version FROM users WHERE id = $1`, [user.id]);
  const { flow, result } = await googleLogin({ sub: `g-${tag()}`, email: user.email, email_verified: true });
  const res = await request.post('/api/auth/oauth/exchange').set('Cookie', flow.cookie).send({ code: result.code });
  assert.equal(res.body.id, user.id);
  const { rows } = await pool.query(`SELECT email_verified, password_hash, token_version FROM users WHERE id = $1`, [user.id]);
  assert.equal(rows[0].email_verified, true);
  assert.equal(rows[0].password_hash, null);
  assert.equal(rows[0].token_version, before.rows[0].token_version + 1);
});

test('adresse non confirmée par Google : pas de rattachement', async () => {
  const user = await createUser();
  const { result } = await googleLogin({ sub: `g-${tag()}`, email: user.email, email_verified: false });
  assert.deepEqual(result, { erreur: 'compte' });
});

test('Facebook : jamais de rattachement par adresse, adresse exigée', async () => {
  const user = await createUser();
  const fb = (me) => oauth.setFetch(async (url, init) => {
    if (url.includes('/oauth/access_token')) {
      assert.equal(new URLSearchParams(init.body).get('client_secret'), 'fb-secret');
      return new Response(JSON.stringify({ access_token: 'fb-token' }), { status: 200 });
    }
    const q = new URL(url).searchParams;
    assert.equal(q.get('appsecret_proof'), crypto.createHmac('sha256', 'fb-secret').update('fb-token').digest('hex'));
    return new Response(JSON.stringify(me), { status: 200 });
  });

  let flow = await start('facebook');
  assert.equal(flow.location.hostname, 'www.facebook.com');
  fb({ id: `f-${tag()}`, email: user.email, first_name: 'Léo' });
  assert.deepEqual(await callback('facebook', flow), { erreur: 'compte' });

  flow = await start('facebook');
  fb({ id: `f-${tag()}`, first_name: 'Léo' });
  assert.deepEqual(await callback('facebook', flow), { erreur: 'email' });

  flow = await start('facebook');
  fb({ id: `f-${tag()}`, email: `fb_${tag()}${DOMAIN}`, first_name: 'Léo' });
  const result = await callback('facebook', flow);
  const signup = await request.get(`/api/auth/oauth/signup?code=${result.inscription}`).set('Cookie', flow.cookie);
  assert.deepEqual(signup.body, { provider: 'facebook', suggestion: 'Leo' });
});

test('invitation : le nouveau joueur devient ami de celui qui l’invite', async () => {
  const inviter = await createUser();
  const { rows } = await pool.query(
    `UPDATE users SET invite_code = $1 WHERE id = $2 RETURNING invite_code`,
    [crypto.randomBytes(3).toString('hex').replace(/[01ilo]/g, 'k').slice(0, 6).padEnd(6, 'k'), inviter.id]
  );
  const code = rows[0].invite_code;
  const { flow, result } = await googleLogin(
    { sub: `g-${tag()}`, email: `inv_${tag()}${DOMAIN}`, email_verified: true },
    { query: `?invitation=${code}` });
  const done = await request.post('/api/auth/oauth/complete').set('Cookie', flow.cookie)
    .send({ code: result.inscription, username: `oa_${tag()}` });
  assert.equal(done.status, 201);
  const friends = await pool.query(
    `SELECT status FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [inviter.id, done.body.id]);
  assert.equal(friends.rows[0]?.status, 'accepted');
});

test('compte sans mot de passe : changement refusé, suppression en recopiant le pseudo', async () => {
  const user = await createUser({ password: null });
  const token = signToken({ id: user.id, username: user.username });
  const pwd = await request.post('/api/users/me/password').set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'quelconque', newPassword: 'Nouveau-mot-de-passe-2026!' });
  assert.equal(pwd.status, 403);
  assert.match(pwd.body.error, /Mot de passe oublié/);

  // Sortie du temps réel simulée : seule la suppression en base est testée ici.
  require('../src/realtime/accountRemoval').setHandler(async (_id, remove) => remove());
  const wrong = await request.delete('/api/users/me').set('Authorization', `Bearer ${token}`).send({ confirmUsername: 'autre' });
  assert.equal(wrong.status, 422);
  const ok = await request.delete('/api/users/me').set('Authorization', `Bearer ${token}`).send({ confirmUsername: user.username });
  assert.equal(ok.status, 200);
});

test('pseudo proposé à partir du prénom', () => {
  assert.equal(oauth.suggestUsername('Jean-Éloi'), 'Jean-Eloi');
  assert.equal(oauth.suggestUsername('Marie Anne'), 'MarieAnne');
  assert.equal(oauth.suggestUsername(null), '');
});
