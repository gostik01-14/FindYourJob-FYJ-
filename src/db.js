const path = require('node:path');
const { mkdir } = require('node:fs/promises');

async function openDatabase(url, directory) {
  let client;
  if (url) {
    const { Pool } = require('pg');
    client = new Pool({ connectionString: url });
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    const location = directory || path.join(process.cwd(), '.data/postgres');
    if (location !== 'memory://') await mkdir(location, { recursive: true });
    client = new PGlite(location);
  }
  await client.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    email VARCHAR(254) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  )`);
  await client.query('CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)');
  return { query: (sql, args) => client.query(sql, args), close: () => url ? client.end() : client.close() };
}
module.exports = { openDatabase };
