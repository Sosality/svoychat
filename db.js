// db.js
import pg from "pg";
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgresql://wwwdydydrh:w5bS%j$$MxZ81f@kj9Df@127.0.0.1:5433/users';

export const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.connect()
  .then(() => console.log('[DB] Connected to PostgreSQL'))
  .catch(err => console.error('[DB] Connection error:', err));
