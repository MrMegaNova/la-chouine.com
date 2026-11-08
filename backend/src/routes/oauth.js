'use strict';

// Connexion avec Google, Facebook ou Apple (/api/auth/oauth).
//
// 1. GET  /:provider           → redirige vers le fournisseur (état en Redis).
// 2. GET|POST /:provider/callback → identifie le joueur, puis redirige vers le site :
//      /connexion/retour?code=…        compte trouvé : code de connexion à usage unique ;
//      /connexion/retour?inscription=… nouveau joueur : il choisit son pseudo ;
//      /connexion/retour?erreur=…      échec (liste fermée de codes).
// 3. POST /exchange  { code }           → jeton de session (JWT).
//    GET  /signup?code=…                → pseudo proposé ;
//    POST /complete { code, username }   → crée le compte, puis jeton de session.
//
// Le JWT ne passe jamais dans une URL. Chaque étape est liée au navigateur qui a
// lancé la connexion par un cookie HttpOnly : un lien de retour volé ou envoyé
// à quelqu'un d'autre ne connecte personne (protection contre la connexion forcée).

const express = require('express');
const crypto = require('crypto');
const { query, withTransaction } = require('../db');
const { signToken } = require('../middleware/auth');
const { getClient } = require('../redis/client');
const { isUsernameAllowed } = require('../services/usernameFilter');
const invitations = require('../services/invitations');
const oauth = require('../services/oauth');

const router = express.Router();

const COOKIE = 'chouine_oauth';
const STATE_TTL_S = 600;
const LOGIN_TTL_S = 120;
const SIGNUP_TTL_S = 1800;
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const RETURN_PATH = '/connexion/retour';

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const key = (kind, id) => `oauth:${kind}:${sha256(id)}`;

function readCookie(req) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// SameSite=None : Apple renvoie le joueur par un POST venant de son domaine,
// qu'un cookie SameSite=Lax ne suivrait pas. Secure est donc obligatoire.
function setCookie(res, value, maxAge) {
  res.append('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/api/auth/oauth; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`);
}

async function put(kind, id, data, ttl) {
  await getClient().set(key(kind, id), JSON.stringify(data), 'EX', ttl);
}

/** Lit et efface (usage unique). */
async function take(kind, id) {
  if (typeof id !== 'string' || id.length < 20 || id.length > 100) return null;
  const raw = await getClient().getdel(key(kind, id));
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Lit sans effacer. */
async function peek(kind, id) {
  if (typeof id !== 'string' || id.length < 20 || id.length > 100) return null;
  const raw = await getClient().get(key(kind, id));
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Le navigateur est-il celui qui a lancé la connexion ? */
function sameBrowser(req, record) {
  const cookie = readCookie(req);
  if (!cookie || !record?.bind) return false;
  const a = Buffer.from(sha256(cookie));
  const b = Buffer.from(record.bind);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const back = (res, params) => res.redirect(303, `${RETURN_PATH}?${new URLSearchParams(params)}`);

async function session(userId) {
  const { rows } = await query(`SELECT id, username, token_version FROM users WHERE id = $1`, [userId]);
  if (!rows.length) return null;
  return { token: signToken(rows[0]), username: rows[0].username, id: rows[0].id };
}

// ─── GET /providers ───────────────────────────────────────────────────────────

router.get('/providers', (_req, res) => {
  res.json({ providers: oauth.enabledProviders() });
});

// ─── POST /exchange ───────────────────────────────────────────────────────────

router.post('/exchange', async (req, res) => {
  try {
    const record = await take('login', req.body?.code);
    if (!record || !sameBrowser(req, record)) {
      return res.status(400).json({ error: 'Lien de connexion invalide ou expiré. Recommencez.' });
    }
    const s = await session(record.userId);
    if (!s) return res.status(400).json({ error: 'Compte introuvable.' });
    setCookie(res, '', 0);
    res.json(s);
  } catch (err) {
    req.log.error({ code: err.code }, 'oauth exchange');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── GET /signup?code=… ───────────────────────────────────────────────────────

router.get('/signup', async (req, res) => {
  try {
    const record = await peek('signup', req.query.code);
    if (!record || !sameBrowser(req, record)) {
      return res.status(400).json({ error: 'Inscription expirée. Recommencez.' });
    }
    res.json({ provider: record.provider, suggestion: oauth.suggestUsername(record.name) });
  } catch (err) {
    req.log.error({ code: err.code }, 'oauth signup');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── POST /complete ───────────────────────────────────────────────────────────

const PG_UNIQUE_VIOLATION = '23505';

async function createAccount(client, record, username, inviteColumn) {
  const { rows } = await client.query(
    `INSERT INTO users (username, email, password_hash, email_verified, invited_by)
     VALUES ($1, $2, NULL, TRUE,
             ${inviteColumn ? `(SELECT id FROM users WHERE ${inviteColumn} = $3 AND email_verified = TRUE)` : 'NULL'})
     RETURNING id, invited_by`,
    inviteColumn ? [username, record.email, record.invitation] : [username, record.email]
  );
  return rows[0];
}

router.post('/complete', async (req, res) => {
  const code = req.body?.code;
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  if (!USERNAME_RE.test(username)) {
    return res.status(422).json({ error: 'Le pseudo doit contenir 2 à 30 caractères (lettres, chiffres, _ ou -).' });
  }
  if (!isUsernameAllowed(username)) {
    return res.status(422).json({ error: 'Ce pseudo n\'est pas disponible.' });
  }

  try {
    const record = await peek('signup', code);
    if (!record || !sameBrowser(req, record)) {
      return res.status(400).json({ error: 'Inscription expirée. Recommencez.' });
    }
    const taken = await query(`SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
    if (taken.rows.length) return res.status(409).json({ error: 'Ce pseudo est déjà pris.' });

    // La colonne vient d'une liste fermée (`codeColumn`), jamais de la requête.
    const inviteColumn = record.invitation ? invitations.codeColumn(record.invitation) : null;
    const user = await withTransaction(async (client) => {
      const created = await createAccount(client, record, username, inviteColumn);
      await client.query(
        `INSERT INTO user_identities (provider, subject, user_id, email) VALUES ($1, $2, $3, $4)`,
        [record.provider, record.subject, created.id, record.email]
      );
      // Adresse confirmée par le fournisseur : l'invitation s'applique tout de suite.
      await invitations.applyInvitation(client, created, req.log);
      return created;
    });
    await take('signup', code);
    setCookie(res, '', 0);
    res.status(201).json(await session(user.id));
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ error: 'Ce pseudo est déjà pris, ou un compte existe déjà avec cette adresse email.' });
    }
    req.log.error({ code: err.code }, 'oauth complete');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── GET /:provider ───────────────────────────────────────────────────────────

router.get('/:provider', async (req, res) => {
  const provider = oauth.getProvider(req.params.provider);
  if (!provider) return back(res, { erreur: 'fournisseur' });

  const bind = oauth.randomToken();
  const state = oauth.randomToken();
  const nonce = oauth.randomToken();
  const verifier = oauth.randomToken();
  const invitation = invitations.normalizeInviteCode(req.query.invitation) ?? null;
  try {
    await put('state', state, { provider: provider.name, bind: sha256(bind), nonce, verifier, invitation }, STATE_TTL_S);
  } catch (err) {
    req.log.error({ code: err.code }, 'oauth start');
    return back(res, { erreur: 'fournisseur' });
  }
  setCookie(res, bind, STATE_TTL_S + SIGNUP_TTL_S);
  res.redirect(302, provider.authorizeUrl({ state, nonce, verifier }));
});

// ─── GET|POST /:provider/callback ─────────────────────────────────────────────

async function callback(req, res) {
  const params = req.method === 'POST' ? (req.body ?? {}) : req.query;
  const record = await take('state', params.state);
  if (!record || record.provider !== req.params.provider || !sameBrowser(req, record)) {
    return back(res, { erreur: 'etat' });
  }
  // Refus ou abandon sur la page du fournisseur.
  if (params.error || typeof params.code !== 'string') return back(res, { erreur: 'annule' });

  const provider = oauth.getProvider(record.provider);
  if (!provider) return back(res, { erreur: 'fournisseur' });

  let who;
  try {
    who = await provider.identity({ code: params.code, verifier: record.verifier, nonce: record.nonce, user: params.user });
  } catch (err) {
    req.log.warn({ provider: provider.name, reason: err.message }, 'oauth : identité refusée');
    return back(res, { erreur: 'fournisseur' });
  }

  const known = await query(
    `SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2`,
    [provider.name, who.subject]
  );
  if (known.rows.length) return login(res, known.rows[0].user_id, record.bind);

  if (!who.email) return back(res, { erreur: 'email' });

  const existing = await query(
    `SELECT id, email_verified, invited_by FROM users WHERE LOWER(email) = LOWER($1)`,
    [who.email]
  );
  if (existing.rows.length) {
    // Rattachement à un compte existant : seulement si le fournisseur garantit
    // que le joueur possède cette adresse.
    if (!provider.trustsEmail || !who.emailVerified) return back(res, { erreur: 'compte' });
    const user = existing.rows[0];
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO user_identities (provider, subject, user_id, email) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [provider.name, who.subject, user.id, who.email]
      );
      if (!user.email_verified) {
        // Compte jamais activé : son mot de passe a pu être choisi par quelqu'un
        // d'autre que le propriétaire de l'adresse. Il est effacé, et les
        // sessions éventuelles révoquées.
        await client.query(
          `UPDATE users SET email_verified = TRUE, password_hash = NULL, verify_token = NULL,
                  verify_expires = NULL, token_version = token_version + 1, updated_at = NOW()
           WHERE id = $1`,
          [user.id]
        );
        await invitations.applyInvitation(client, user, req.log);
      }
    });
    return login(res, user.id, record.bind);
  }

  // Nouveau joueur : il choisit son pseudo sur le site.
  const signup = oauth.randomToken();
  await put('signup', signup, {
    provider: provider.name, subject: who.subject, email: who.email, name: who.name,
    invitation: record.invitation, bind: record.bind,
  }, SIGNUP_TTL_S);
  return back(res, { inscription: signup });
}

async function login(res, userId, bind) {
  const code = oauth.randomToken();
  await put('login', code, { userId, bind }, LOGIN_TTL_S);
  return back(res, { code });
}

const handle = async (req, res) => {
  try {
    await callback(req, res);
  } catch (err) {
    req.log.error({ code: err.code }, 'oauth callback');
    back(res, { erreur: 'fournisseur' });
  }
};

router.get('/:provider/callback', handle);
router.post('/:provider/callback', express.urlencoded({ extended: false, limit: '16kb' }), handle);

module.exports = router;
