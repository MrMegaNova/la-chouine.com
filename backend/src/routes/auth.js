'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query, withTransaction } = require('../db');
const { signToken } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail, logMailError } = require('../services/email');
const { isUsernameAllowed } = require('../services/usernameFilter');
const { authGuard } = require('../services/authGuard');
const { validatePassword } = require('../services/passwordPolicy');
const invitations = require('../services/invitations');
const config = require('../config');

// Garde-fous anti-abus (#86) — débrayés en test, comme les rate limiters
// (le module est testé unitairement dans tests/authGuard.test.js).
const guardsOff = config.isTest;

const router = express.Router();

// Hash comparé quand le pseudo est inconnu, pour que le login coûte le même
// calcul bcrypt que le compte existe ou non (#223). Il doit être valide (60
// caractères) : bcryptjs répond `false` sans rien calculer sur un hash mal formé.
// Généré au chargement pour suivre le coût configuré, à partir d'un secret jeté.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  crypto.randomBytes(32).toString('hex'),
  config.auth.bcryptRounds
);

// Violation d'unicité Postgres : la contrainte DB est la vraie garde (#224).
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const ACCOUNT_TAKEN_ERROR = 'Ce pseudo ou cette adresse email est déjà utilisé.';

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

function insertUser(username, email, passwordHash, verifyHash, verifyExpires, inviteCode) {
  // Un code inconnu donne NULL : l'inscription réussit à l'identique (#295).
  // La colonne vient d'une liste fermée (`codeColumn`), jamais de la requête.
  const column = inviteCode ? invitations.codeColumn(inviteCode) : 'invite_code';
  return query(
    `INSERT INTO users (username, email, password_hash, verify_token, verify_expires, invited_by)
     VALUES ($1, $2, $3, $4, $5,
             (SELECT id FROM users WHERE ${column} = $6 AND email_verified = TRUE))
     RETURNING id, username, email`,
    [username, email, passwordHash, verifyHash, verifyExpires, inviteCode]
  );
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  // Champ-piège anti-bot (#86) : invisible pour un humain (masqué en CSS),
  // les bots le remplissent. Faux succès pour ne pas les renseigner.
  if (typeof req.body.website === 'string' && req.body.website.trim() !== '') {
    // Log (sans PII) : sans trace, une inscription légitime avalée par un
    // autofill remplissant le piège était invisible en prod (#203).
    req.log.warn({ ip: req.ip }, 'inscription : champ-piège anti-bot déclenché');
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

  const { username, email, password, invitationCode } = req.body;
  const inviteCode = invitations.normalizeInviteCode(invitationCode);

  try {
    // Vérifier unicité insensible à la casse
    const exists = await query(
      `SELECT 1 FROM users
       WHERE username = $1 OR LOWER(email) = LOWER($2)
       LIMIT 1`,
      [username, email]
    );
    if (exists.rows.length) {
      return res.status(409).json({ errors: [ACCOUNT_TAKEN_ERROR] });
    }

    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const verifyToken = generateToken();
    const verifyExpires = new Date(Date.now() + config.auth.verifyTokenTtlMs);

    const verifyHash = hashToken(verifyToken);
    const { rows } = await insertUser(username, email, passwordHash, verifyHash, verifyExpires, inviteCode)
      .catch(err => {
        // Le compte qui invite vient d'être supprimé : l'inscription continue sans lui.
        if (err.code !== PG_FOREIGN_KEY_VIOLATION) throw err;
        return insertUser(username, email, passwordHash, verifyHash, verifyExpires, null);
      });
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
    // Course entre le SELECT ci-dessus et l'INSERT : une requête concurrente a
    // créé le compte entre-temps (#224). Cas attendu, pas une erreur serveur.
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ errors: [ACCOUNT_TAKEN_ERROR] });
    }
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
    // Le token ne sert qu'une fois : un second clic ne réapplique rien (#295).
    const verified = await withTransaction(async client => {
      const { rows } = await client.query(
        `UPDATE users
         SET email_verified = TRUE, verify_token = NULL, verify_expires = NULL, updated_at = NOW()
         WHERE verify_token = $1
           AND verify_expires > NOW()
           AND email_verified = FALSE
         RETURNING id, invited_by`,
        [hashToken(token)]
      );
      if (!rows.length) return false;
      await invitations.applyInvitation(client, rows[0], req.log);
      return true;
    });

    if (!verified) {
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
    const validHash = user ? user.password_hash : DUMMY_PASSWORD_HASH;
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
