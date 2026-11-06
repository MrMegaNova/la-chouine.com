'use strict';

// Géolocalisation des visites (#311), sur place, sans appel à un service tiers.
//  1. MaxMind GeoLite2 City : la plus précise en France. Téléchargée et tenue à
//     jour par le conteneur geoipupdate (licence : base de moins de 30 jours),
//     relue automatiquement à chaque mise à jour du fichier.
//  2. DB-IP Lite City : embarquée dans l'image, en secours tant que la base
//     MaxMind n'est pas disponible.
// Sans aucune base (dev, tests), la localisation reste vide.

const fs = require('fs');
const maxmind = require('maxmind');
const { logger } = require('../logger');

const SOURCES = [
  { name: 'MaxMind GeoLite2', path: process.env.GEOIP_MAXMIND_DB || '/geoip/GeoLite2-City.mmdb', watch: true },
  { name: 'DB-IP Lite', path: process.env.GEOIP_DB || '/app/geo/dbip-city-lite.mmdb', watch: false },
];
// Sur la base de secours, on revérifie de temps en temps si MaxMind est arrivée.
const RECHECK_MS = 60 * 60 * 1000;

let current = null; // { reader, source }
let loading = null;
let checkedAt = 0;

/** Première source dont le fichier existe, ou null. */
function pickSource(exists = fs.existsSync, sources = SOURCES) {
  return sources.find(s => exists(s.path)) ?? null;
}

async function open(source) {
  try {
    // watchForUpdates : geoipupdate remplace le fichier, le lecteur suit.
    // NonPersistent : la surveillance ne retient pas le processus à l'arrêt.
    const reader = await maxmind.open(source.path, source.watch
      ? { watchForUpdates: true, watchForUpdatesNonPersistent: true }
      : {});
    logger.info({ source: source.name }, 'géolocalisation : base chargée');
    return { reader, source };
  } catch (err) {
    logger.error({ err, path: source.path }, 'géolocalisation : base illisible');
    return null;
  }
}

async function load() {
  checkedAt = Date.now();
  const source = pickSource();
  if (!source) {
    logger.warn('géolocalisation désactivée : aucune base disponible');
    return null;
  }
  return open(source);
}

async function getCurrent() {
  const onFallback = !current || current.source !== SOURCES[0];
  if (!loading || (onFallback && Date.now() - checkedAt > RECHECK_MS)) {
    loading = load().then(c => { if (c) current = c; return current; });
  }
  return loading;
}

const nameOf = (names) => (names?.fr ?? names?.en ?? null)?.slice(0, 100) ?? null;

/** { country, region, city } pour une IP, champs à null s'ils sont inconnus. */
async function locate(ip) {
  const empty = { country: null, region: null, city: null };
  const c = await getCurrent();
  if (!c || !ip || !maxmind.validate(ip)) return empty;
  const hit = c.reader.get(ip);
  if (!hit) return empty;
  return {
    country: hit.country?.iso_code ?? null,
    region: nameOf(hit.subdivisions?.[0]?.names),
    city: nameOf(hit.city?.names),
  };
}

/** Nom de la base utilisée, pour le tableau de bord et l'attribution. */
async function sourceName() {
  const c = await getCurrent();
  return c?.source.name ?? null;
}

/** Pour les tests : remplace la base (ou la retire avec null). */
function setReader(reader, name = 'test') {
  current = reader ? { reader, source: { name } } : null;
  loading = Promise.resolve(current);
  checkedAt = Date.now();
}

module.exports = { locate, sourceName, setReader, pickSource, SOURCES };
