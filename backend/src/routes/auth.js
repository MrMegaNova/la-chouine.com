'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../db');
const { signToken } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail, logMailError } = require('../services/email');
const { isUsernameAllowed } = require('../services/usernameFilter');
const { authGuard } = require('../services/authGuard');
const { validatePassword } = require('../services/passwordPolicy');
const config = require('../config');

// Garde-fous anti-abus (#86) — débrayés en test, comme les rate limiters
// (le module est testé unitairement dans tests/authGuard.test.js).
const guardsOff = config.isTest;

const router = express.Router();

// ─── Validation ───────────────────────────────────────────────────────────────

const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegister(body) {
  const errors = [];
  const { username, email, password } = body;
  if (!username || !USERNAME_RE.test(username))
    errors.push('Le pseudo doit contenir 2 à 30 caractères (lettres, chiffres, _ ou -).');
  else if (!isUsernameAllowed(username))
    // Message volontairement neutre : ne pas révéler la liste ni la règle (#72).
    errors.push('Ce pseudo n\'est pas disponible.');
  if (!email || !EMAIL_RE.test(email))
    errors.push('Adresse email invalide.');
  const pwdError = validatePassword(password);
  if (pwdError) errors.push(pwdError);
  return errors;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 chars hex
}

// Seul le HASH du token est stocké en base (#122) : une fuite de dump ne
// permet pas de réutiliser un lien de vérification/réinitialisation. Le token
// en clair ne transite que dans l'email. SHA-256 (token aléatoire à haute
// entropie → pas besoin de sel/KDF, contrairement à un mot de passe).
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  // Champ-piège anti-bot (#86) : invisible pour un humain (masqué en CSS),
  // les bots le remplissent. Faux succès pour ne pas les renseigner.
  if (typeof req.body.website === 'string' && req.body.website.trim() !== '') {
    return res.status(201).json({
      message: 'Compte créé. Un email de confirmation a été envoyé à votre adresse.',
    });
  }

  // Plafond d'inscriptions par IP (#86) — contre la création de comptes en masse.
  if (!guardsOff && !authGuard.registerAllowed(req.ip)) {
    return res.status(429).json({
      errors: ['Trop de comptes créés récemment depuis cette adresse. Réessayez plus tard.'],
    });
  }

  const errors = validateRegister(req.body);
  if (errors.length) return res.status(422).json({ errors });

  const { username, email, password } = req.body;

  try {
    // Vérifier unicité insensible à la casse
    const exists = await query(
      `SELECT 1 FROM users
       WHERE username = $1 OR LOWER(email) = LOWER($2)
       LIMIT 1`,
      [username, email]
    );
    if (exists.rows.length) {
      return res.status(409).json({
        errors: ['Ce pseudo ou cette adresse email est déjà utilisé.'],
      });
    }

    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const verifyToken = generateToken();
    const verifyExpires = new Date(Date.now() + config.auth.verifyTokenTtlMs);

    const { rows } = await query(
      `INSERT INTO users (username, email, password_hash, verify_token, verify_expires)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email`,
      [username, email, passwordHash, hashToken(verifyToken), verifyExpires]
    );
    const user = rows[0];

    if (!guardsOff) authGuard.registerRecorded(req.ip); // compte créé → décompte IP (#86)

    // Envoi de l'email — non bloquant pour la réponse
    sendVerificationEmail(user.email, verifyToken, user.username).catch(err =>
      logMailError('email de vérification', err)
    );

    res.status(201).json({
      message:
        'Compte créé. Un email de confirmation a été envoyé à votre adresse.',
    });
  } catch (err) {
    req.log.error({ err }, 'register');
    res.status(500).json({ errors: ['Erreur interne. Réessayez.'] });
  }
});

// ─── GET /api/auth/verify-email?token=… ──────────────────────────────────────

router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string' || token.length !== 64) {
    return res.status(400).json({ error: 'Token invalide.' });
  }

  try {
    const { rows } = await query(
      `UPDATE users
       SET email_verified = TRUE, verify_token = NULL, verify_expires = NULL, updated_at = NOW()
       WHERE verify_token = $1
         AND verify_expires > NOW()
         AND email_verified = FALSE
       RETURNING id, username`,
      [hashToken(token)]
    );

    if (!rows.length) {
      return res.status(400).json({ error: 'Lien invalide ou expiré.' });
    }

    res.json({ message: 'Adresse email confirmée. Vous pouvez vous connecter.' });
  } catch (err) {
    req.log.error({ err }, 'verify-email');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(422).json({ error: 'Pseudo et mot de passe requis.' });
  }

  // Anti-brute-force (#86) : blocage temporaire du couple IP+pseudo après
  // N échecs — message générique, pour ne pas révéler l'existence du compte.
  if (!guardsOff && !authGuard.loginAllowed(req.ip, username).allowed) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez plus tard.' });
  }

  try {
    const { rows } = await query(
      `SELECT id, username, email, password_hash, email_verified, token_version
       FROM users WHERE username = $1`,
      [username]
    );
    const user = rows[0];

    // Toujours appeler bcrypt pour éviter le timing oracle
    const validHash = user ? user.password_hash : '$2a$12$invalide.hash.pour.eviter.timing';
    const match = await bcrypt.compare(password, validHash);

    if (!user || !match) {
      if (!guardsOff) authGuard.loginFailed(req.ip, username);
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }
    if (!user.email_verified) {
      // Identifiants corrects : ce n'est pas une attaque, on ne compte pas.
      return res.status(403).json({
        error: 'Compte non activé. Vérifiez vos emails.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    if (!guardsOff) authGuard.loginSucceeded(req.ip, username);
    const token = signToken(user);
    res.json({ token, username: user.username, id: user.id });
  } catch (err) {
    req.log.error({ err }, 'login');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  // Réponse identique qu'il existe ou non pour éviter l'énumération
  const generic = { message: 'Si ce compte existe, un email a été envoyé.' };

  if (!email || !EMAIL_RE.test(email)) {
    return res.json(generic);
  }

  try {
    const { rows } = await query(
      `SELECT id, username, email, email_verified FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    if (!rows.length) return res.json(generic);

    const user = rows[0];

    // Anti-mail-bombing (#121) : un seul email de reset/activation par adresse
    // et par fenêtre. La garde n'est consultée que pour un compte existant (ne
    // pas créer de signal d'énumération), et la réponse reste générique.
    if (!guardsOff && !authGuard.resetEmailAllowed(user.email)) {
      return res.json(generic);
    }

    // Compte non activé (#105) : le formulaire « mot de passe oublié » sert
    // aussi à renvoyer un lien d'activation — sans quoi un compte dont le
    // lien initial a expiré (24 h) resterait définitivement inactivable.
    if (!user.email_verified) {
      const verifyToken = generateToken();
      const verifyExpires = new Date(Date.now() + config.auth.verifyTokenTtlMs);

      await query(
        `UPDATE users SET verify_token = $1, verify_expires = $2, updated_at = NOW()
         WHERE id = $3`,
        [hashToken(verifyToken), verifyExpires, user.id]
      );

      if (!guardsOff) authGuard.resetEmailSent(user.email); // cooldown (#121)
      sendVerificationEmail(user.email, verifyToken, user.username).catch(err =>
        logMailError('email de vérification (renvoi)', err)
      );

      return res.json(generic);
    }

    const resetToken = generateToken();
    const resetExpires = new Date(Date.now() + 3_600_000); // 1 h

    await query(
      `UPDATE users SET reset_token = $1, reset_expires = $2, updated_at = NOW()
       WHERE id = $3`,
      [hashToken(resetToken), resetExpires, user.id]
    );

    if (!guardsOff) authGuard.resetEmailSent(user.email); // cooldown (#121)
    sendPasswordResetEmail(user.email, resetToken, user.username).catch(err =>
      logMailError('email reset', err)
    );

    res.json(generic);
  } catch (err) {
    req.log.error({ err }, 'forgot-password');
    res.json(generic); // Ne pas révéler l'erreur
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || typeof token !== 'string' || token.length !== 64) {
    return res.status(400).json({ error: 'Token invalide.' });
  }
  const pwdError = validatePassword(password);
  if (pwdError) return res.status(422).json({ error: pwdError });

  try {
    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
    // token_version + 1 : révoque tous les JWT émis avant le reset (#117).
    const { rows } = await query(
      `UPDATE users
       SET password_hash = $1, reset_token = NULL, reset_expires = NULL,
           token_version = token_version + 1, updated_at = NOW()
       WHERE reset_token = $2 AND reset_expires > NOW()
       RETURNING id`,
      [passwordHash, hashToken(token)]
    );

    if (!rows.length) {
      return res.status(400).json({ error: 'Lien invalide ou expiré.' });
    }
    res.json({ message: 'Mot de passe modifié. Vous pouvez vous connecter.' });
  } catch (err) {
    req.log.error({ err }, 'reset-password');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
