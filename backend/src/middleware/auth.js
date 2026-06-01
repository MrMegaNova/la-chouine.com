'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Middleware qui vérifie le JWT en Authorization: Bearer <token>.
 * Injecte req.user = { id, username } si valide.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant.' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
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

module.exports = { requireAuth, signToken };
