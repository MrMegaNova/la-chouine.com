'use strict';

// Mesure d'audience (#311). Une ligne par page vue ; l'IP complète est effacée
// au bout de IP_RETENTION_DAYS (annoncé sur la page Confidentialité).

const crypto = require('crypto');
const config = require('../config');
const geo = require('./geo');

const IP_RETENTION_DAYS = 30;

// Robots et outils automatiques : ignorés.
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|curl|wget|python|axios|node-fetch|go-http|java\//i;

function isBot(userAgent) {
  return !userAgent || BOT_RE.test(userAgent);
}

function deviceOf(userAgent) {
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android|windows phone/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

/**
 * Empreinte non réversible du visiteur pour la journée : IP + navigateur +
 * date, salés par un secret serveur. Permet de compter les visiteurs uniques
 * par jour sans garder l'IP au-delà de sa durée de conservation.
 */
function visitorKey(ip, userAgent, day) {
  return crypto.createHmac('sha256', config.jwt.secret)
    .update(`visit|${day}|${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 32);
}

/** Chemin de page nettoyé : sans requête ni fragment, borné. */
function cleanPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null;
  const path = raw.split(/[?#]/)[0];
  // Les codes des liens d'invitation ne sont pas des pages distinctes.
  return path.replace(/^\/(i|invitation)\/[^/]+/, '/$1/:code').slice(0, 200);
}

/** Domaine du site d'origine, hors le site lui-même. */
function referrerHost(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '');
    const own = new URL(config.frontend.url).hostname.replace(/^www\./, '');
    return host && host !== own ? host.slice(0, 100) : null;
  } catch {
    return null;
  }
}

/**
 * Campagne d'arrivée (`?src=affiche`) : minuscules, lettres, chiffres, « - »
 * et « _ » seulement, 40 caractères au plus. Sinon, rien.
 */
function cleanSource(raw) {
  if (typeof raw !== 'string') return null;
  const source = raw.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(source) ? source : null;
}

async function recordVisit(query, { ip, userAgent, path, referrer, source, userId }, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const where = await geo.locate(ip);
  await query(
    `INSERT INTO visits (created_at, path, referrer_host, device, ip, country, region, city, visitor_key, source, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             (SELECT id FROM users WHERE id = $11::uuid))`,
    [now, path, referrerHost(referrer), deviceOf(userAgent), ip || null,
      where.country, where.region, where.city, visitorKey(ip, userAgent, day), cleanSource(source), userId ?? null]
  );
}

/** Efface les IP plus anciennes que la durée de conservation. */
async function purgeOldIps(query) {
  const { rowCount } = await query(
    `UPDATE visits SET ip = NULL
     WHERE ip IS NOT NULL AND created_at < NOW() - make_interval(days => $1)`,
    [IP_RETENTION_DAYS]
  );
  return rowCount;
}

module.exports = {
  IP_RETENTION_DAYS, isBot, deviceOf, visitorKey, cleanPath, cleanSource, referrerHost, recordVisit, purgeOldIps,
};
