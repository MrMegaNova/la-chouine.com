'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Vérifie un JWT et renvoie l'utilisateur { id, username }, ou null si invalide.
 * Réutilisable hors du cycle HTTP (ex. authentification d'une connexion WebSocket).
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    return { id: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

/**
 * Middleware qui vérifie le JWT en Authorization: Bearer <token>.
 * Injecte req.user = { id, username } si valide.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant.' });
  }
  const user = verifyToken(header.slice(7));
  if (!user) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
  req.user = user;
  next();
}

/**
 * Génère un JWT signé pour un utilisateur.
 */
function signToken(user) {
  return jwt.sign(
    { username: user.username },
    config.jwt.secret,
    { subject: user.id, expiresIn: config.jwt.expiresIn }
  );
}

module.exports = { requireAuth, signToken, verifyToken };
