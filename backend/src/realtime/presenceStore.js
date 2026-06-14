'use strict';

// ─── Présence & grâce cross-instance dans Redis (#31) ─────────────────────────
// En multi-instance, un joueur peut avoir des onglets sur plusieurs process.
// On suit donc l'ensemble des instances où il est connecté ; il est « en ligne »
// tant qu'au moins une instance le déclare. Les compteurs (#43) sont agrégés
// depuis Redis (online + file + en partie). La grâce (#30) — armée quand un
// joueur n'a plus AUCUN socket nulle part — porte une deadline lue par le sweep.
//
// Clés :
//   online:{uid}  → set des instanceId où le joueur est connecté
//   online:set    → set des userId en ligne (pour le compte agrégé)
//   grace:{uid}   → deadline (ms epoch) avant forfait
//   grace:set     → set des userId en grâce (parcouru par le sweep)
//
// Limite assumée (v1) : un crash d'instance laisse ses marqueurs online jusqu'à
// expiration logique au prochain nettoyage — léger sur-comptage temporaire, sans
// incidence sur le jeu.

const { getClient, instanceId } = require('../redis/client');
const matchmakingStore = require('./matchmakingStore');
const sessionStore = require('./sessionStore');

const K = {
  online: (uid) => `online:${uid}`,
  onlineSet: 'online:set',
  grace: (uid) => `grace:${uid}`,
  graceSet: 'grace:set',
};

/** Marque le joueur connecté sur cette instance. */
async function addOnline(userId) {
  const r = getClient();
  await r.sadd(K.online(userId), instanceId);
  await r.sadd(K.onlineSet, userId);
}

/** Retire cette instance ; si plus aucune, le joueur n'est plus en ligne. */
async function removeOnline(userId) {
  const r = getClient();
  await r.srem(K.online(userId), instanceId);
  if ((await r.scard(K.online(userId))) === 0) {
    await r.del(K.online(userId));
    await r.srem(K.onlineSet, userId);
  }
}

async function isOnline(userId) {
  return (await getClient().scard(K.online(userId))) > 0;
}

async function onlineCount() {
  return getClient().scard(K.onlineSet);
}

/** Compteurs agrégés pour la présence (#43). */
async function counts() {
  const [online, inQueue, inGame] = await Promise.all([
    onlineCount(), matchmakingStore.totalSize(), sessionStore.activeUserCount(),
  ]);
  return { online, inQueue, inGame };
}

/** Présence d'un joueur précis (#46) — pour la liste d'amis. */
async function userPresence(userId) {
  const [online, sid] = await Promise.all([isOnline(userId), sessionStore.sessionIdForUser(userId)]);
  return { online, inGame: !!sid };
}

// ── Grâce (#30) ──
async function setGrace(userId, deadline) {
  const r = getClient();
  await r.set(K.grace(userId), String(deadline));
  await r.sadd(K.graceSet, userId);
}
async function getGrace(userId) {
  const v = await getClient().get(K.grace(userId));
  return v === null ? null : Number(v);
}
async function clearGrace(userId) {
  const r = getClient();
  await r.del(K.grace(userId));
  await r.srem(K.graceSet, userId);
}
async function listGraces() {
  return getClient().smembers(K.graceSet);
}

module.exports = {
  K, addOnline, removeOnline, isOnline, onlineCount, counts, userPresence,
  setGrace, getGrace, clearGrace, listGraces,
};
