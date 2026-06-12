'use strict';

const fs = require('fs');
const path = require('path');

const { pool } = require('./index');

// Logger dédié au CLI de migration : toujours actif (le logger applicatif est
// silencieux en NODE_ENV=test, or les migrations CI tournent justement en test
// et leur sortie doit rester visible). Format lisible (jamais JSON) ; couleurs
// seulement en TTY.
const logger = require('pino')({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: !!process.stdout.isTTY, ignore: 'pid,hostname,time' },
  },
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename  TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const dir = path.join(__dirname, '../../migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file]
      );
      if (rows.length) {
        logger.info(`✓ ${file} (déjà appliqué)`);
        continue;
      }

      logger.info(`→ Application de ${file}…`);
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        logger.info(`✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    logger.info('Migrations terminées.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  logger.error({ err }, 'Échec des migrations');
  process.exit(1);
});
