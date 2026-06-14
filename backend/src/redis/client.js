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
 * Tests : injecte un client (ioredis-mock ou vrai ioredis). Le subscriber est
 * (re)créé paresseusement par getSubscriber() — surtout pas en avance, sinon une
 * ré-injection (beforeEach) abandonnerait des connexions ouvertes qui
 * empêcheraient node --test de se terminer.
 */
function setClient(c) {
  // Ferme l'ancien subscriber avant de le remplacer : sinon une ré-injection
  // (beforeEach) abandonnerait une connexion abonnée ouverte qui empêcherait
  // node --test de se terminer (event loop maintenu vivant).
  if (subscriber && subscriber !== client && typeof subscriber.disconnect === 'function') {
    try { subscriber.disconnect(); } catch { /* déjà fermée */ }
  }
  client = c;
  subscriber = null;
}

async function close() {
  // On ferme les connexions mais on NE remet PAS les références à null : un
  // balayage/boucle encore en vol pourrait rappeler getClient() et, le client
  // étant null, recréer une VRAIE connexion (erreurs de résolution en test).
  // Garder la référence du client fermé fait échouer/no-op ces appels sans
  // ouvrir de nouvelle connexion. setClient() réinitialise pour le test suivant.
  for (const c of [subscriber, client]) {
    if (c && typeof c.quit === 'function') {
      try { await c.quit(); } catch { /* déjà fermé */ }
    }
  }
}

module.exports = { instanceId, getClient, getSubscriber, setClient, close };
