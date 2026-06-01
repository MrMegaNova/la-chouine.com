'use strict';

const fs = require('fs');
const path = require('path');

const { pool } = require('./index');

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
        console.log(`  ✓ ${file} (déjà appliqué)`);
        continue;
      }

      console.log(`  → Application de ${file}…`);
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('Migrations terminées.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Échec des migrations :', err.message);
  process.exit(1);
});
