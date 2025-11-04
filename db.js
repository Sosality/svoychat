// db.js
import pg from "pg";
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgresql://svoychatdb_user:tK11hGJtTLbkDMsneRJaei0WpD8rgkj0@dpg-d44qsf0dl3ps73bi5g10-a:5432/users';

export const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.connect()
  .then(() => console.log('[DB] Connected to PostgreSQL'))
  .catch(err => console.error('[DB] Connection error:', err));
