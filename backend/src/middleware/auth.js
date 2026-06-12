'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Vérifie la SIGNATURE d'un JWT et renvoie { id, username, ver }, ou null.
 * `ver` est la version de token du compte au moment de l'émission (#117) —
 * les tokens antérieurs à cette mécanique valent 0.
 * Réutilisable hors du cycle HTTP (ex. authentification d'une connexion
 * WebSocket) ; la comparaison à la version en base est faite séparément
 * (cf. checkTokenVersion) car elle nécessite un accès asynchrone à la DB.
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    return { id: payload.sub, username: payload.username, ver: payload.ver ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Le token correspond-il à la version courante du compte ? (#117)
 * Un changement/réinitialisation de mot de passe incrémente users.token_version,
 * ce qui révoque tous les tokens émis avant.
 */
async function checkTokenVersion(user) {
  const { query } = require('../db'); // require paresseux : pas de DB pour signer/vérifier
  const { rows } = await query(
    `SELECT token_version FROM users WHERE id = $1`,
    [user.id]
  );
  if (!rows.length) return false; // compte supprimé
  return Number(rows[0].token_version) === Number(user.ver ?? 0);
}

/**
 * Middleware qui vérifie le JWT en Authorization: Bearer <token> — signature
 * PUIS version de token (#117). Injecte req.user = { id, username }.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant.' });
  }
  const user = verifyToken(header.slice(7));
  if (!user) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
  try {
    if (!(await checkTokenVersion(user))) {
      return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
    }
  } catch (err) {
    console.error('requireAuth token_version error:', err);
    return res.status(500).json({ error: 'Erreur interne.' });
  }
  req.user = user;
  next();
}

/**
 * Génère un JWT signé pour un utilisateur. `user.token_version` (si fourni)
 * est embarqué pour permettre la révocation (#117).
 */
function signToken(user) {
  return jwt.sign(
    { username: user.username, ver: user.token_version ?? 0 },
    config.jwt.secret,
    { subject: user.id, expiresIn: config.jwt.expiresIn }
  );
}

module.exports = { requireAuth, signToken, verifyToken, checkTokenVersion };
