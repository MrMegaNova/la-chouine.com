'use strict';

const { Pool } = require('pg');
const config = require('../config');
const { logger } = require('../logger');

const pool = new Pool({
  host:     config.db.host,
  port:     config.db.port,
  user:     config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl:      config.db.ssl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Erreur pool PostgreSQL inattendue');
});

/**
 * Exécute une requête paramétrée. Lève une erreur en cas d'échec.
 * @param {string} text  Requête SQL avec placeholders $1, $2, …
 * @param {any[]}  params Valeurs
 */
async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

/**
 * Démarre une transaction et passe un client à la fonction callback.
 * Commit si succès, rollback si exception.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
