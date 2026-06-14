'use strict';

// ─── Bus pub/sub cross-instance (#31) ─────────────────────────────────────────
// Achemine les messages temps-réel entre instances : une instance applique un
// coup et publie le snapshot ; toutes les instances le reçoivent et le livrent
// aux sockets locaux du destinataire. Un seul canal `rt`, charge utile
// `{ kind, userId?, ... }` ; chaque instance filtre selon ses sockets locaux.
//
// Les canaux Redis sont GLOBAUX (non cloisonnés par DB) : en test sur un Redis
// partagé, RT_NS préfixe le canal pour isoler les fichiers entre eux (les clés,
// elles, sont isolées par index de DB).

const { getClient, getSubscriber } = require('../redis/client');

const channel = () => `${process.env.RT_NS || ''}rt`;

let started = false;
const handlers = new Set();

/** Publie un message à toutes les instances (y compris l'émettrice). */
async function publish(msg) {
  await getClient().publish(channel(), JSON.stringify(msg));
}

/** Enregistre un handler de message entrant. Renvoie une fonction de retrait. */
function onMessage(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

/** Démarre l'abonnement (idempotent). */
async function start() {
  if (started) return;
  started = true;
  const sub = getSubscriber();
  await sub.subscribe(channel());
  sub.on('message', (ch, raw) => {
    if (ch !== channel()) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    for (const h of handlers) { try { h(msg); } catch { /* un handler ne bloque pas les autres */ } }
  });
}

async function stop() {
  started = false;
  handlers.clear();
  try { await getSubscriber().unsubscribe(channel()); } catch { /* déjà fermé */ }
}

module.exports = { publish, onMessage, start, stop, channel };
