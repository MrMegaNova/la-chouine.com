'use strict';

// Connexion avec Google, Facebook ou Apple : flux « authorization code » côté
// serveur, avec PKCE (Google) et nonce (Google, Apple).
//
// Le jeton d'identité (id_token) de Google et d'Apple est reçu directement de
// leur point d'échange, en HTTPS et avec notre secret : la spécification
// OpenID Connect (§ 3.1.3.7) dispense alors d'en vérifier la signature. On en
// contrôle l'émetteur, le destinataire, l'expiration et le nonce.
//
// Chaque fournisseur n'est actif que si ses variables d'environnement sont
// renseignées ; sinon son bouton n'est pas proposé.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const FB_VERSION = 'v23.0';

// Injectable pour les tests.
let fetchImpl = (...args) => fetch(...args);
function setFetch(fn) { fetchImpl = fn ?? ((...args) => fetch(...args)); }

function env(name) {
  return (process.env[name] || '').trim();
}

/** Base des adresses de retour : le site public (le proxy nginx sert /api). */
function redirectBase() {
  return (env('OAUTH_REDIRECT_BASE') || env('FRONTEND_URL') || 'https://la-chouine.com').replace(/\/+$/, '');
}

function redirectUri(provider) {
  return `${redirectBase()}/api/auth/oauth/${provider}/callback`;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const randomToken = () => b64url(crypto.randomBytes(32));
const pkceChallenge = (verifier) => b64url(crypto.createHash('sha256').update(verifier).digest());

class OAuthError extends Error {
  /** @param {string} code code d'erreur transmis au site (liste fermée) */
  constructor(code, detail) {
    super(detail || code);
    this.code = code;
  }
}

async function postForm(url, params) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new OAuthError('provider', `échange du code refusé (${res.status})`);
  return data;
}

/** Contenu d'un id_token reçu du point d'échange, contrôlé. */
function checkIdToken(idToken, { issuers, audience, nonce }) {
  const claims = typeof idToken === 'string' ? jwt.decode(idToken) : null;
  if (!claims || typeof claims !== 'object') throw new OAuthError('provider', 'id_token absent');
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!issuers.includes(claims.iss)) throw new OAuthError('provider', 'émetteur inattendu');
  if (!aud.includes(audience)) throw new OAuthError('provider', 'destinataire inattendu');
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new OAuthError('provider', 'id_token expiré');
  if (nonce && claims.nonce !== nonce) throw new OAuthError('provider', 'nonce invalide');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new OAuthError('provider', 'identifiant absent');
  return claims;
}

const verified = (v) => v === true || v === 'true';

// ─── Fournisseurs ─────────────────────────────────────────────────────────────

const google = {
  name: 'google',
  label: 'Google',
  enabled: () => Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
  // Google confirme la propriété de l'adresse (`email_verified`).
  trustsEmail: true,
  authorizeUrl({ state, nonce, verifier }) {
    const q = new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      redirect_uri: redirectUri('google'),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
  async identity({ code, verifier, nonce }) {
    const tokens = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri('google'),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    const c = checkIdToken(tokens.id_token, {
      issuers: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env('GOOGLE_CLIENT_ID'),
      nonce,
    });
    return {
      subject: c.sub,
      email: typeof c.email === 'string' ? c.email : null,
      emailVerified: verified(c.email_verified),
      name: c.given_name || c.name || null,
    };
  },
};

const facebook = {
  name: 'facebook',
  label: 'Facebook',
  enabled: () => Boolean(env('FACEBOOK_APP_ID') && env('FACEBOOK_APP_SECRET')),
  // Facebook ne dit pas si l'adresse a été confirmée : elle n'est jamais
  // utilisée pour rattacher un compte existant.
  trustsEmail: false,
  // Client confidentiel (secret côté serveur) : pas de PKCE, l'état lié au
  // navigateur protège le retour.
  authorizeUrl({ state }) {
    const q = new URLSearchParams({
      client_id: env('FACEBOOK_APP_ID'),
      redirect_uri: redirectUri('facebook'),
      response_type: 'code',
      scope: 'public_profile,email',
      state,
    });
    return `https://www.facebook.com/${FB_VERSION}/dialog/oauth?${q}`;
  },
  async identity({ code }) {
    const tokens = await postForm(`https://graph.facebook.com/${FB_VERSION}/oauth/access_token`, {
      code,
      client_id: env('FACEBOOK_APP_ID'),
      client_secret: env('FACEBOOK_APP_SECRET'),
      redirect_uri: redirectUri('facebook'),
    });
    if (typeof tokens.access_token !== 'string') throw new OAuthError('provider', 'jeton Facebook absent');
    // appsecret_proof : le jeton seul ne suffit pas pour appeler l'API en notre nom.
    const proof = crypto.createHmac('sha256', env('FACEBOOK_APP_SECRET')).update(tokens.access_token).digest('hex');
    const q = new URLSearchParams({ fields: 'id,first_name,email', access_token: tokens.access_token, appsecret_proof: proof });
    const res = await fetchImpl(`https://graph.facebook.com/${FB_VERSION}/me?${q}`, { signal: AbortSignal.timeout(10_000) });
    const me = await res.json().catch(() => ({}));
    if (!res.ok || typeof me.id !== 'string') throw new OAuthError('provider', `profil Facebook refusé (${res.status})`);
    return {
      subject: me.id,
      email: typeof me.email === 'string' ? me.email : null,
      emailVerified: false,
      name: me.first_name || null,
    };
  },
};

/** Secret client d'Apple : un JWT ES256 signé avec la clé privée du compte développeur. */
function appleClientSecret() {
  const key = env('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  return jwt.sign({}, key, {
    algorithm: 'ES256',
    keyid: env('APPLE_KEY_ID'),
    issuer: env('APPLE_TEAM_ID'),
    subject: env('APPLE_CLIENT_ID'),
    audience: 'https://appleid.apple.com',
    expiresIn: '5m',
  });
}

const apple = {
  name: 'apple',
  label: 'Apple',
  enabled: () => Boolean(env('APPLE_CLIENT_ID') && env('APPLE_TEAM_ID') && env('APPLE_KEY_ID') && env('APPLE_PRIVATE_KEY')),
  // Apple confirme l'adresse, y compris l'adresse relais « Masquer mon adresse ».
  trustsEmail: true,
  authorizeUrl({ state, nonce }) {
    // Avec les portées name/email, Apple répond par un POST (form_post).
    const q = new URLSearchParams({
      client_id: env('APPLE_CLIENT_ID'),
      redirect_uri: redirectUri('apple'),
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name email',
      state,
      nonce,
    });
    return `https://appleid.apple.com/auth/authorize?${q}`;
  },
  async identity({ code, nonce, user }) {
    const tokens = await postForm('https://appleid.apple.com/auth/token', {
      code,
      client_id: env('APPLE_CLIENT_ID'),
      client_secret: appleClientSecret(),
      redirect_uri: redirectUri('apple'),
      grant_type: 'authorization_code',
    });
    const c = checkIdToken(tokens.id_token, {
      issuers: ['https://appleid.apple.com'],
      audience: env('APPLE_CLIENT_ID'),
      nonce,
    });
    // Le prénom n'est transmis qu'à la toute première autorisation.
    let name = null;
    try { name = JSON.parse(user || '{}')?.name?.firstName || null; } catch { /* champ absent ou illisible */ }
    return {
      subject: c.sub,
      email: typeof c.email === 'string' ? c.email : null,
      emailVerified: verified(c.email_verified),
      name,
    };
  },
};

const PROVIDERS = { google, facebook, apple };

function getProvider(name) {
  const p = Object.prototype.hasOwnProperty.call(PROVIDERS, name) ? PROVIDERS[name] : null;
  return p && p.enabled() ? p : null;
}

function enabledProviders() {
  return Object.values(PROVIDERS).filter(p => p.enabled()).map(p => p.name);
}

/** Pseudo proposé à partir du prénom : caractères autorisés seulement. */
function suggestUsername(name) {
  if (typeof name !== 'string') return '';
  const ascii = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return ascii.replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 30);
}

module.exports = {
  OAuthError, getProvider, enabledProviders, randomToken, redirectUri, suggestUsername, setFetch,
  checkIdToken, pkceChallenge,
};
