'use strict';

// Lien d'invitation personnel (#295). L'inscription conserve seulement le compte
// qui invite (`users.invited_by`) : l'amitié et le badge ne sont accordés qu'à la
// vérification de l'email, pour qu'un compte non vérifié ne déclenche rien.

const crypto = require('crypto');
const config = require('../config');
const { awardFact } = require('./achievements');

const AMBASSADOR_BADGE = 'ambassadeur';
const INVITE_CODE_RE = /^[0-9a-f]{32}$/;

function isInviteCode(value) {
  return typeof value === 'string' && INVITE_CODE_RE.test(value);
}

function inviteUrl(code) {
  return `${config.frontend.url}/invitation/${code}`;
}

/**
 * Renvoie le code du joueur, créé à sa première demande. COALESCE garde le
 * premier code si deux requêtes arrivent en même temps. 128 bits aléatoires,
 * sans lien avec l'email ou l'identifiant.
 */
async function ensureInviteCode(query, userId) {
  const { rows } = await query(
    `UPDATE users SET invite_code = COALESCE(invite_code, $1)
     WHERE id = $2
     RETURNING invite_code`,
    [crypto.randomBytes(16).toString('hex'), userId]
  );
  return rows[0]?.invite_code ?? null;
}

/** Compte qui porte ce code, ou null. Seul un compte vérifié peut inviter. */
async function findInviter(query, code) {
  if (!isInviteCode(code)) return null;
  const { rows } = await query(
    `SELECT id, username FROM users WHERE invite_code = $1 AND email_verified = TRUE`,
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
  isInviteCode,
  inviteUrl,
  ensureInviteCode,
  findInviter,
  grantInvitation,
  applyInvitation,
};
