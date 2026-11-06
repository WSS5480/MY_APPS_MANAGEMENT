'use strict';
const { Pool, types } = require('pg');
const { E } = require('./meta');

types.setTypeParser(1700, v => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10))); // bigint
types.setTypeParser(1082, v => v); // date as YYYY-MM-DD string

const url = process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/mna';
const local = /localhost|127\.0\.0\.1|\/tmp\//.test(url) || process.env.PGSSL === '0';
const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 8, idleTimeoutMillis: 30000 });
pool.on('error', e => console.error('[pg] idle client error', e.message));

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await pool.query(sql, params)).rows[0] || null;
const all = async (sql, params) => (await pool.query(sql, params)).rows;

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

const SQLT = { text: 'text', longtext: 'text', select: 'text', file: 'integer', ref: 'integer', int: 'integer', num: 'numeric(18,4)', money: 'numeric(18,2)', pct: 'numeric(9,2)', date: 'date', datetime: 'timestamptz', bool: 'boolean' };
const colType = f => SQLT[f.t] || 'text';

async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(424242)');
    await c.query(`CREATE TABLE IF NOT EXISTS files (id serial primary key, name text, mime text, size int, data bytea, created_by int, created_at timestamptz default now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS audit_log (id bigserial primary key, ts timestamptz default now(), user_id int, user_name text, role text, entity text, record_id int, action text, detail jsonb)`);
    await c.query(`CREATE INDEX IF NOT EXISTS audit_rec ON audit_log(entity, record_id)`);
    await c.query(`CREATE TABLE IF NOT EXISTS notifications (id bigserial primary key, ts timestamptz default now(), user_id int, role text, title text, body text, link text, read boolean default false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS policy_acks (id serial primary key, policy_id int, version int, user_id int, ts timestamptz default now(), unique(policy_id, version, user_id))`);
    await c.query(`CREATE TABLE IF NOT EXISTS settings (k text primary key, v jsonb)`);
    for (const e of Object.values(E)) {
      await c.query(`CREATE TABLE IF NOT EXISTS ${e.k} (id serial primary key, status text, lines jsonb default '[]'::jsonb, created_at timestamptz default now(), created_by int, updated_at timestamptz default now(), updated_by int)`);
      for (const f of e.fields) {
        if (f.t === 'pin') { await c.query(`ALTER TABLE ${e.k} ADD COLUMN IF NOT EXISTS pin_hash text`); continue; }
        await c.query(`ALTER TABLE ${e.k} ADD COLUMN IF NOT EXISTS ${f.k} ${colType(f)}`);
      }
    }
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_pin ON users(pin_hash) WHERE pin_hash IS NOT NULL`);
  } finally {
    await c.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    c.release();
  }
}

module.exports = { pool, q, one, all, tx, migrate };
