'use strict';

// Format UUID — source unique, partagée par les routes qui reçoivent un
// identifiant du client (routes/users.js, routes/friends.js, #227). À vérifier
// avant toute requête : Postgres rejette un cast invalide (22P02), soit un 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `typeof` indispensable : RegExp.test() convertit en chaîne, un corps JSON
// `["<uuid>"]` passerait la regex puis casserait le cast côté Postgres.
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

module.exports = { isUuid };
