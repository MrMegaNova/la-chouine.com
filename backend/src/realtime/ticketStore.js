'use strict';

// ─── Tickets WebSocket éphémères (#120) ───────────────────────────────────────
// Le JWT ne doit plus transiter dans l'URL du WebSocket (`?token=`) : les query
// strings finissent dans les logs des proxys (Traefik/nginx) → des JWT valides
// 7 jours y traîneraient. À la place, le client demande (authentifié) un
// **ticket** aléatoire à usage unique, à courte durée de vie, et ouvre le WS
// avec `?ticket=…`. Les logs ne contiennent que des tickets déjà expirés/consommés.

const { randomUUID } = require('crypto');
const { getClient } = require('../redis/client');

const KEY = (t) => `wsticket:${t}`;
const TTL_MS = 30_000; // 30 s : le temps d'ouvrir la connexion

/** Émet un ticket pour le payload utilisateur (issu du JWT). */
async function issue(user) {
  const ticket = randomUUID();
  const payload = JSON.stringify({ id: user.id, username: user.username, ver: user.ver ?? 0 });
  await getClient().set(KEY(ticket), payload, 'PX', TTL_MS);
  return ticket;
}

/** Consomme un ticket (usage unique : lecture + suppression atomiques). */
async function consume(ticket) {
  if (!ticket) return null;
  const res = await getClient().multi().get(KEY(ticket)).del(KEY(ticket)).exec();
  const raw = res && res[0] && res[0][1];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

module.exports = { issue, consume, TTL_MS };
