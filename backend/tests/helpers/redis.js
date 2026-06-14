'use strict';

// Helper Redis pour les tests (#31).
//
// Le code applicatif parle à un vrai Redis (ioredis) via REDIS_URL — obligatoire
// en prod. En test, on injecte un `ioredis-mock` (in-process, aucune dépendance
// réseau) via le point d'injection `setClient` du module redis/client, sur le
// même principe que notifier.setSender / presence.setProvider.
//
// Isolation : `node --test` lance chaque FICHIER dans un process séparé ; le mock
// étant en mémoire de process, chaque fichier a son propre Redis — pas de
// collision inter-fichiers comme sur la base Postgres partagée. On flush quand
// même entre les tests d'un même fichier (les instances mock partagent le store
// du process). Deux instances mock partagent données ET pub/sub → on peut
// simuler deux instances backend dans un seul process de test.

const RedisMock = require('ioredis-mock');
const client = require('../../src/redis/client');

/** Pose un client mock comme client Redis applicatif. Renvoie le client. */
function useMockRedis() {
  const mock = new RedisMock();
  client.setClient(mock);
  return mock;
}

/** Vide le Redis mock du process (à appeler en début de chaque test). */
async function flush(c) {
  await c.flushall();
}

module.exports = { useMockRedis, flush };
