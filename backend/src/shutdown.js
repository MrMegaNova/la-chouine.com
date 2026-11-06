'use strict';

// Arrêt propre (#237), sur SIGTERM (Docker) ou SIGINT (Ctrl+C en dev) :
//   1. arrêt du temps réel : boucles stoppées, WebSockets fermés (les parties
//      vivent dans Redis et reprennent sur l'instance suivante, #31) ;
//   2. fermeture du serveur HTTP, connexions inactives comprises ;
//   3. fermeture des connexions PostgreSQL et Redis ;
//   4. sortie 0. Au-delà de `timeoutMs`, sortie forcée en 1.

function createShutdown({ server, getRealtime, closeDb, closeRedis, logger, exit = process.exit, timeoutMs = 5000 }) {
  let running = null;

  return function shutdown(signal) {
    if (running) return running;
    logger.info({ signal }, 'arrêt demandé');

    const timer = setTimeout(() => {
      logger.error({ timeoutMs }, 'arrêt trop long : sortie forcée');
      exit(1);
    }, timeoutMs);

    running = (async () => {
      try {
        const realtime = getRealtime();
        if (realtime) realtime.stop();
        await new Promise((resolve) => {
          if (!server.listening) return resolve();
          server.close(() => resolve());
          // Sans cela, une connexion HTTP keep-alive retient close() jusqu'à son délai.
          server.closeIdleConnections?.();
        });
        await Promise.allSettled([closeDb(), closeRedis()]);
        logger.info('arrêt terminé');
        clearTimeout(timer);
        exit(0);
      } catch (err) {
        logger.error({ err }, 'arrêt : erreur');
        clearTimeout(timer);
        exit(1);
      }
    })();
    return running;
  };
}

module.exports = { createShutdown };
