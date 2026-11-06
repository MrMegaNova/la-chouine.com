'use strict';

// Géolocalisation des visites (#311) : base locale DB-IP Lite (ville, CC BY 4.0),
// lue sur place, sans appel à un service tiers. Sans fichier (dev, tests), la
// localisation reste vide et rien d'autre ne change.

const fs = require('fs');
const maxmind = require('maxmind');
const { logger } = require('../logger');

const DB_PATH = process.env.GEOIP_DB || '/app/geo/dbip-city-lite.mmdb';

let reader = null;
let loading = null;

async function load(path = DB_PATH) {
  if (!fs.existsSync(path)) {
    logger.warn({ path }, 'géolocalisation désactivée : base DB-IP absente');
    return null;
  }
  try {
    return await maxmind.open(path);
  } catch (err) {
    logger.error({ err, path }, 'géolocalisation désactivée : base DB-IP illisible');
    return null;
  }
}

/** Charge la base une seule fois, au premier besoin. */
function getReader() {
  if (!loading) loading = load().then(r => { reader = r; return r; });
  return loading;
}

/** { country, region, city } pour une IP, champs à null s'ils sont inconnus. */
async function locate(ip) {
  const empty = { country: null, region: null, city: null };
  const r = reader || await getReader();
  if (!r || !ip || !maxmind.validate(ip)) return empty;
  const hit = r.get(ip);
  if (!hit) return empty;
  return {
    country: hit.country?.iso_code ?? null,
    region: hit.subdivisions?.[0]?.names?.en?.slice(0, 100) ?? null,
    city: hit.city?.names?.en?.slice(0, 100) ?? null,
  };
}

/** Pour les tests : remplace la base (ou la retire avec null). */
function setReader(r) {
  reader = r;
  loading = Promise.resolve(r);
}

module.exports = { locate, setReader, load };
