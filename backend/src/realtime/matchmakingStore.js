'use strict';

// ─── File de matchmaking dans Redis (#31) ─────────────────────────────────────
// Remplace les Maps en mémoire du Matchmaker par un stockage Redis partagé entre
// instances. Par variante : un sorted set `mm:z:{variant}` (score = Elo) pour
// l'ordre, et un hash `mm:t:{userId}` portant le ticket complet. La logique
// d'appariement (fenêtre d'Elo, plus proche voisin) reste la fonction pure
// `pairTickets` de matchmaking.js — une seule source de vérité avec la file en
// mémoire d'origine.
//
// La boucle d'appariement (wsServer) est protégée par un verrou Redis pour qu'une
// seule instance apparie à un instant donné (sinon doublons de parties).

const { getClient } = require('../redis/client');
const { pairTickets } = require('./matchmaking');

const VARIANTS = ['classic', 'mondoubleau'];
const Z = (variant) => `mm:z:${variant}`;     // sorted set userId -> rating
const T = (userId) => `mm:t:${userId}`;       // hash ticket

const DEFAULT_PARAMS = { initialWindow: 50, growthPerStep: 25, stepMs: 3000, fallbackMs: 30000 };

/** Inscrit (ou réinscrit) un joueur ; un seul ticket par joueur, toutes files confondues. */
async function join({ userId, name, rating, variant }, now = Date.now()) {
  await leave(userId);
  const r = getClient();
  await r.zadd(Z(variant), rating, userId);
  await r.hset(T(userId), { userId, name, rating, variant, joinedAt: now });
}

/** Retire un joueur de sa file. Renvoie true s'il y était. */
async function leave(userId) {
  const r = getClient();
  const variant = await r.hget(T(userId), 'variant');
  if (!variant) return false;
  await r.zrem(Z(variant), userId);
  await r.del(T(userId));
  return true;
}

async function has(userId) {
  return (await getClient().exists(T(userId))) === 1;
}

async function size(variant) {
  return getClient().zcard(Z(variant));
}

/** Joueurs en attente, toutes variantes confondues. */
async function totalSize() {
  const r = getClient();
  const counts = await Promise.all(VARIANTS.map(v => r.zcard(Z(v))));
  return counts.reduce((a, b) => a + b, 0);
}

/** Tickets d'une variante, désérialisés (rating/joinedAt en nombres). */
async function listTickets(variant) {
  const r = getClient();
  const ids = await r.zrange(Z(variant), 0, -1);
  const tickets = await Promise.all(ids.map(id => r.hgetall(T(id))));
  return tickets
    .filter(t => t && t.userId)
    .map(t => ({ userId: t.userId, name: t.name, rating: Number(t.rating), variant: t.variant, joinedAt: Number(t.joinedAt) }));
}

/**
 * Apparie sur toutes les variantes et retire les appariés de Redis.
 * @returns {Promise<Array<[ticket, ticket]>>}
 */
async function findMatches(params = DEFAULT_PARAMS, now = Date.now()) {
  const pairs = [];
  for (const variant of VARIANTS) {
    const tickets = await listTickets(variant);
    if (tickets.length < 2) continue;
    const vPairs = pairTickets(tickets, params, now);
    for (const [a, b] of vPairs) {
      await leave(a.userId);
      await leave(b.userId);
      pairs.push([a, b]);
    }
  }
  return pairs;
}

/** Vide la file (utilitaire de test). */
async function reset() {
  const r = getClient();
  for (const v of VARIANTS) {
    const ids = await r.zrange(Z(v), 0, -1);
    if (ids.length) await r.del(...ids.map(T));
    await r.del(Z(v));
  }
}

module.exports = { join, leave, has, size, totalSize, listTickets, findMatches, reset, DEFAULT_PARAMS };
