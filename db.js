// db.js
import pg from "pg";
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/svoychat';

export const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.connect()
  .then(() => console.log('[DB] Connected to PostgreSQL'))
  .catch(err => console.error('[DB] Connection error:', err));
