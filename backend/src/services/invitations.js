'use strict';

// Lien d'invitation personnel (#295). L'inscription conserve seulement le compte
// qui invite (`users.invited_by`) : l'amitié et le badge ne sont accordés qu'à la
// vérification de l'email, pour qu'un compte non vérifié ne déclenche rien.

const crypto = require('crypto');
const config = require('../config');
const { awardFact } = require('./achievements');

const AMBASSADOR_BADGE = 'ambassadeur';

// Code court (#306) : 6 caractères sans caractères ambigus (ni 0, 1, i, l, o),
// soit 31^6 ≈ 887 millions de codes. Deviner un code ne révèle qu'un pseudo,
// déjà public, et les routes qui l'acceptent sont limitées en débit.
const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const CODE_LENGTH = 6;
const SHORT_CODE_RE = /^[2-9a-hjkmnp-z]{6}$/;
// Codes distribués avant #306, toujours acceptés.
const LEGACY_CODE_RE = /^[0-9a-f]{32}$/;
const MAX_CODE_ATTEMPTS = 5;

/**
 * Code d'invitation normalisé, ou null s'il est mal formé. Un code court saisi
 * en majuscules est accepté.
 */
function normalizeInviteCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  return SHORT_CODE_RE.test(code) || LEGACY_CODE_RE.test(code) ? code : null;
}

function isInviteCode(value) {
  return normalizeInviteCode(value) !== null;
}

function generateInviteCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

// Lien le plus court : sans `www.`, le domaine nu redirige en gardant le chemin.
function inviteUrl(code) {
  return `${config.frontend.url.replace('://www.', '://')}/i/${code}`;
}

/**
 * Renvoie le code du joueur, créé à sa première demande. COALESCE garde le
 * premier code si deux requêtes arrivent en même temps. Un code déjà pris par
 * un autre joueur (violation d'unicité) est retiré au sort.
 */
async function ensureInviteCode(query, userId) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { rows } = await query(
        `UPDATE users SET invite_code = COALESCE(invite_code, $1)
         WHERE id = $2
         RETURNING invite_code`,
        // Passe par module.exports pour que les tests puissent forcer une collision.
        [module.exports.generateInviteCode(), userId]
      );
      return rows[0]?.invite_code ?? null;
    } catch (err) {
      if (err.code !== '23505' || attempt >= MAX_CODE_ATTEMPTS) throw err;
    }
  }
}

/** Colonne qui porte ce code normalisé : court ou d'avant #306. */
function codeColumn(code) {
  return SHORT_CODE_RE.test(code) ? 'invite_code' : 'invite_code_legacy';
}

/** Compte qui porte ce code, ou null. Seul un compte vérifié peut inviter. */
async function findInviter(query, rawCode) {
  const code = normalizeInviteCode(rawCode);
  if (!code) return null;
  const { rows } = await query(
    `SELECT id, username FROM users WHERE ${codeColumn(code)} = $1 AND email_verified = TRUE`,
    [code]
  );
  return rows[0] ?? null;
}

async function makeFriends(client, inviterId, inviteeId) {
  // Une relation peut exister dans un sens ou dans l'autre : la contrainte
  // d'unicité de `friendships` ne couvre qu'un sens à la fois.
  const { rows } = await client.query(
    `SELECT id, status FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2)
        OR (requester_id = $2 AND addressee_id = $1)
     FOR UPDATE`,
    [inviterId, inviteeId]
  );
  // Un blocage n'est jamais levé par une invitation.
  if (rows.some(r => r.status === 'accepted' || r.status === 'blocked')) return;

  if (rows.length) {
    await client.query(`UPDATE friendships SET status = 'accepted' WHERE id = $1`, [rows[0].id]);
    return;
  }
  await client.query(
    `INSERT INTO friendships (requester_id, addressee_id, status)
     VALUES ($1, $2, 'accepted')
     ON CONFLICT (requester_id, addressee_id) DO NOTHING`,
    [inviterId, inviteeId]
  );
}

/** Accorde l'amitié et le badge. Idempotent, à appeler dans une transaction. */
async function grantInvitation(client, inviterId, inviteeId) {
  await makeFriends(client, inviterId, inviteeId);
  await awardFact(client, inviterId, AMBASSADOR_BADGE);
}

/**
 * Applique l'invitation dans la transaction qui vérifie l'email. Le SAVEPOINT
 * isole un échec : la vérification du compte reste validée, sans amitié ni badge.
 * Seul le code d'erreur est journalisé : le détail d'une erreur Postgres peut
 * contenir des valeurs de la ligne.
 */
async function applyInvitation(client, invitee, log) {
  if (!invitee.invited_by) return;
  await client.query('SAVEPOINT invitation');
  try {
    // Passe par module.exports pour que les tests puissent simuler un échec.
    await module.exports.grantInvitation(client, invitee.invited_by, invitee.id);
    await client.query('RELEASE SAVEPOINT invitation');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT invitation');
    log.error({ code: err.code }, 'invitation non appliquée à la vérification');
  }
}

module.exports = {
  normalizeInviteCode,
  isInviteCode,
  generateInviteCode,
  codeColumn,
  inviteUrl,
  ensureInviteCode,
  findInviter,
  grantInvitation,
  applyInvitation,
};
