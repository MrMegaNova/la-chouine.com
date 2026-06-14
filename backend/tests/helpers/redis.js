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

/**
 * Pose un client comme client Redis applicatif. Renvoie le client.
 * Par défaut : ioredis-mock (in-process). Si REDIS_TEST_REAL=1, un VRAI client
 * ioredis sur REDIS_URL — pour valider le code contre un vrai serveur Redis
 * (le mock peut diverger). Lancer alors les fichiers Redis un par un pour éviter
 * les collisions sur le serveur partagé.
 */
let current = null;

/**
 * @param {number} [db] index de DB Redis propre au fichier de test (1-15). En CI
 *   (vrai Redis partagé, fichiers en parallèle), chaque fichier prend sa propre
 *   DB → `flushdb` n'efface que ses clés, jamais celles d'un autre fichier —
 *   l'analogue Redis des domaines email distincts sur la base Postgres partagée
 *   (cf. CLAUDE.md). Sans effet sur le mock (isolé par process). Choisir un index
 *   distinct par fichier de test touchant Redis.
 */
function useMockRedis(db = 1) {
  if (current) { try { current.disconnect(); } catch { /* déjà fermé */ } }
  if (process.env.REDIS_TEST_REAL === '1') {
    const IORedis = require('ioredis');
    current = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, db });
  } else {
    current = new RedisMock();
  }
  client.setClient(current);
  return current;
}

/** Vide la DB Redis du fichier (à appeler en début de chaque test). */
async function flush(c) {
  await c.flushdb();
}

/**
 * Ferme les connexions Redis (à appeler dans un `after()`). Indispensable avec un
 * VRAI Redis : une connexion ioredis ouverte garde l'event loop vivant et
 * `node --test` ne se terminerait jamais. Sans effet notable sur le mock.
 */
async function closeRedis() {
  if (current) { try { current.disconnect(); } catch { /* déjà fermé */ } current = null; }
  await client.close();
}

module.exports = { useMockRedis, flush, closeRedis };
