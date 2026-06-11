'use strict';

// Registre en mémoire des parties PvP en cours. Suffisant pour un process unique ;
// un backend Redis sera nécessaire pour scaler horizontalement (cf. #17).

const { randomUUID } = require('crypto');
const { GameSession } = require('../game/session');

const sessions = new Map();    // sessionId -> GameSession
const userSession = new Map(); // userId    -> sessionId

function createSession({ players, variant = 'classic', target = 3 }) {
  const id = randomUUID();
  const session = new GameSession({ id, players, variant, target });
  sessions.set(id, session);
  for (const p of players) userSession.set(p.userId, id);
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function sessionForUser(userId) {
  const id = userSession.get(userId);
  return id ? sessions.get(id) || null : null;
}

function endSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  for (const p of s.players) {
    if (userSession.get(p.userId) === id) userSession.delete(p.userId);
  }
  sessions.delete(id);
}

/** Nombre de joueurs actuellement en partie (toutes sessions confondues). */
function activeUserCount() {
  return userSession.size;
}

function reset() { // utilitaire de test
  sessions.clear();
  userSession.clear();
}

module.exports = { createSession, getSession, sessionForUser, endSession, activeUserCount, reset };
