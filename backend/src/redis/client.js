'use strict';

// ─── Client Redis partagé (#31) ───────────────────────────────────────────────
// État temps-réel PvP (file, sessions, présence, défis) externalisé dans Redis
// pour permettre N instances backend. Redis est OBLIGATOIRE : sans REDIS_URL le
// backend refuse de démarrer (cf. config.js — required('REDIS_URL')).
//
// Deux connexions : la principale (commandes) et une connexion ABONNÉE dédiée —
// le protocole Redis interdit d'émettre des commandes ordinaires sur un socket
// en mode subscribe. `instanceId` identifie cette instance pour le routage
// pub/sub des notifications vers le process qui détient le socket d'un joueur.
//
// Injection de dépendance (même esprit que notifier/presence) : les tests
// posent un client ioredis-mock via setClient() et ne touchent jamais le réseau.

const { randomUUID } = require('crypto');

const instanceId = randomUUID();

let client = null;      // connexion principale (commandes)
let subscriber = null;  // connexion dédiée au mode subscribe (pub/sub)

function createClient() {
  const IORedis = require('ioredis');
  const config = require('../config');
  // maxRetriesPerRequest: null → ne rejette pas les commandes pendant une
  // reconnexion (le temps-réel préfère réessayer plutôt qu'échouer un coup).
  return new IORedis(config.redis.url, { maxRetriesPerRequest: null });
}

/** Connexion principale (créée à la demande). */
function getClient() {
  if (!client) client = createClient();
  return client;
}

/** Connexion abonnée dédiée (duplicate de la principale). */
function getSubscriber() {
  if (!subscriber) subscriber = getClient().duplicate();
  return subscriber;
}

/**
 * Tests : injecte un client (ioredis-mock). Le subscriber est dérivé par
 * duplicate() s'il existe, sinon on réutilise le même (le mock partage l'état).
 */
function setClient(c) {
  client = c;
  subscriber = typeof c.duplicate === 'function' ? c.duplicate() : c;
}

async function close() {
  for (const c of [subscriber, client]) {
    if (c && typeof c.quit === 'function') {
      try { await c.quit(); } catch { /* déjà fermé */ }
    }
  }
  client = null;
  subscriber = null;
}

module.exports = { instanceId, getClient, getSubscriber, setClient, close };
