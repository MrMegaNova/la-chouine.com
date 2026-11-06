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
// Un crash d'instance laisse ses marqueurs online : ils expirent (TTL logique)
// et le sweep retire périodiquement de `onl:set` les joueurs sans marqueur
// vivant (`purgeOnlineSet`, #234). Le sur-comptage dure donc au plus un TTL
// plus une période de purge.

const { getClient, instanceId } = require('../redis/client');
const matchmakingStore = require('./matchmakingStore');
const sessionStore = require('./sessionStore');

const K = {
  online: (uid) => `onl:${uid}`,
  onlineSet: 'onl:set',
  // `onl:{uid}` (et non `online:{uid}`) : nouveau type (sorted set avec
  // expiration). Renommé pour ne pas entrer en collision de type avec
  // d'anciennes clés `online:{uid}` (SET) encore présentes dans un Redis non
  // vidé après déploiement → évite les erreurs WRONGTYPE.
  grace: (uid) => `grace:${uid}`,
  graceSet: 'grace:set',
};

// `online:{uid}` est un SORTED SET { membre: instanceId, score: expiration }.
// Une instance qui meurt (crash, redéploiement, `node --watch`) ne nettoie pas
// ses marqueurs : sans expiration, ils resteraient « en ligne » à jamais et
// `isOnline` renverrait vrai → la détection de déconnexion (#30) ne s'armerait
// jamais. Le marqueur expire donc (TTL), rafraîchi par le heartbeat tant que le
// joueur a un socket vivant sur cette instance.
const ONLINE_TTL_MS = 90_000;

// Purge + comptage en un seul script (#299) : exécuté d'un bloc par Redis, il
// ne peut pas s'intercaler avec un `addOnline`. En plusieurs commandes, un
// marqueur écrit entre le comptage et le nettoyage était effacé, et un joueur
// connecté apparaissait hors ligne.
const LIVE_MARKERS_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local n = redis.call('ZCARD', KEYS[1])
if n == 0 then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[2])
end
return n`;

/** Retire les marqueurs expirés ; renvoie le nombre de marqueurs vivants. */
async function liveMarkers(userId) {
  return Number(await getClient().eval(
    LIVE_MARKERS_SCRIPT, 2, K.online(userId), K.onlineSet, Date.now(), userId
  ));
}

/** Marque le joueur connecté sur cette instance (marqueur à durée limitée). */
async function addOnline(userId) {
  await getClient().multi()
    .zadd(K.online(userId), Date.now() + ONLINE_TTL_MS, instanceId)
    .sadd(K.onlineSet, userId)
    .exec();
}

/**
 * Retire de `onl:set` les joueurs sans marqueur vivant (#234), par exemple
 * ceux d'une instance arrêtée brutalement. Renvoie le nombre de joueurs retirés.
 */
async function purgeOnlineSet() {
  let removed = 0;
  for (const uid of await getClient().smembers(K.onlineSet)) {
    if ((await liveMarkers(uid)) === 0) removed += 1;
  }
  return removed;
}

/**
 * Rafraîchit le marqueur de CETTE instance pour des joueurs encore connectés
 * localement (appelé périodiquement par le heartbeat). Empêche l'expiration des
 * joueurs réellement en ligne.
 */
async function refreshOnline(userIds) {
  if (!userIds || !userIds.length) return;
  const r = getClient();
  const score = Date.now() + ONLINE_TTL_MS;
  const pipe = r.multi();
  for (const uid of userIds) { pipe.zadd(K.online(uid), score, instanceId); pipe.sadd(K.onlineSet, uid); }
  await pipe.exec();
}

/** Retire le marqueur de cette instance ; nettoie si plus aucun marqueur vivant. */
async function removeOnline(userId) {
  await getClient().zrem(K.online(userId), instanceId);
  await liveMarkers(userId);
}

async function isOnline(userId) {
  return (await liveMarkers(userId)) > 0;
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
  K, ONLINE_TTL_MS, addOnline, refreshOnline, removeOnline, isOnline,
  onlineCount, purgeOnlineSet, counts, userPresence, setGrace, getGrace, clearGrace, listGraces,
};
