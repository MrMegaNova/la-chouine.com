'use strict';

// ─── Persistance Redis des sessions PvP (#31) ─────────────────────────────────
// L'état de partie (GameSession sérialisée) vit dans Redis pour : (1) être lu par
// n'importe quelle instance, (2) survivre à un redéploiement/crash. Chaque
// session note l'instance « propriétaire » (celle qui fait tourner ses timers —
// horloge #141, délai de grâce #30) pour le routage des actions en multi-instance.
//
// Clés :
//   sess:{id}        → JSON de la session (toJSON/fromJSON)
//   sess:user:{uid}  → id de la session du joueur
//   sess:owner:{id}  → instanceId propriétaire
//   sess:active      → set des userId en partie (compteur de présence)
//   sess:lock:{id}   → verrou de mutation (un seul mutateur à la fois)
//
// Les mutations passent par withLock() pour sérialiser les coups concurrents
// (deux instances ne doivent jamais appliquer un coup en même temps).

const { randomUUID } = require('crypto');
const { getClient, instanceId } = require('../redis/client');
const { GameSession } = require('../game/session');

const K = {
  sess: (id) => `sess:${id}`,
  user: (uid) => `sess:user:${uid}`,
  owner: (id) => `sess:owner:${id}`,
  lock: (id) => `sess:lock:${id}`,
  active: 'sess:active',
  ids: 'sess:ids',
};

/** Écrit l'état courant de la session dans Redis. */
async function save(session) {
  await getClient().set(K.sess(session.id), JSON.stringify(session.toJSON()));
}

/** Crée une session, la persiste et l'attribue à une instance propriétaire. */
async function createSession({ players, variant = 'classic', target = 3, rated = true, clockOptions, owner = instanceId }) {
  const id = randomUUID();
  const session = new GameSession({ id, players, variant, target, rated, clockOptions });
  const pipe = getClient().multi();
  pipe.set(K.sess(id), JSON.stringify(session.toJSON()));
  pipe.set(K.owner(id), owner);
  pipe.sadd(K.ids, id);
  for (const p of players) { pipe.set(K.user(p.userId), id); pipe.sadd(K.active, p.userId); }
  await pipe.exec();
  return session;
}

/** Charge et reconstruit une session, ou null. */
async function getSession(id) {
  const raw = await getClient().get(K.sess(id));
  return raw ? GameSession.fromJSON(JSON.parse(raw)) : null;
}

async function sessionIdForUser(userId) {
  return getClient().get(K.user(userId));
}

async function sessionForUser(userId) {
  const id = await sessionIdForUser(userId);
  return id ? getSession(id) : null;
}

/** Instance propriétaire d'une session (celle qui fait tourner ses timers). */
async function ownerOf(id) {
  return getClient().get(K.owner(id));
}

/** Supprime une session et tous ses index. */
async function endSession(id) {
  const session = await getSession(id);
  const pipe = getClient().multi();
  pipe.del(K.sess(id), K.owner(id), K.lock(id));
  pipe.srem(K.ids, id);
  if (session) {
    for (const p of session.players) {
      pipe.srem(K.active, p.userId);
      pipe.del(K.user(p.userId));
    }
  }
  await pipe.exec();
}

/** Nombre de joueurs actuellement en partie (toutes sessions confondues). */
async function activeUserCount() {
  return getClient().scard(K.active);
}

/** Ids des sessions en cours — parcourus par le sweep des deadlines (horloge/grâce). */
async function listActiveSessionIds() {
  return getClient().smembers(K.ids);
}

// Libération sûre : ne supprime le verrou que si on le détient encore (le jeton
// correspond), pour ne pas effacer le verrou repris par une autre instance après
// expiration. Atomique via Lua sur un vrai Redis.
const RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Exécute fn en détenant le verrou de la session (mutations sérialisées entre
 * instances). Acquiert via SET NX PX, réessaie brièvement, libère en fin.
 */
async function withLock(id, fn, { ttlMs = 5000, retryMs = 20, maxWaitMs = 2000 } = {}) {
  const r = getClient();
  const token = randomUUID();
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const ok = await r.set(K.lock(id), token, 'PX', ttlMs, 'NX');
    if (ok) break;
    if (Date.now() >= deadline) throw new Error(`Verrou de session indisponible : ${id}`);
    await new Promise((res) => setTimeout(res, retryMs));
  }
  try {
    return await fn();
  } finally {
    try {
      await r.eval(RELEASE_LUA, 1, K.lock(id), token);
    } catch {
      // Repli si le moteur ne supporte pas eval : libération non atomique.
      if (await r.get(K.lock(id)) === token) await r.del(K.lock(id));
    }
  }
}

module.exports = {
  K, save, createSession, getSession, sessionForUser, sessionIdForUser,
  ownerOf, endSession, activeUserCount, listActiveSessionIds, withLock,
};
