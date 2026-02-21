/**
 * Database client — Supabase primary, SQLite local fallback.
 * On recovery, syncs local writes back to Supabase automatically.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import { telegram } from '../monitoring/telegram.js';

let _supabase: SupabaseClient | null = null;
let supabaseDown = false;

function getSupabase(): SupabaseClient {
  if (!_supabase) _supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  return _supabase;
}

function isConnError(err: unknown): boolean {
  return err instanceof Error &&
    (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed'));
}

export async function dbInsert(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const { data: result, error } = await getSupabase().from(table).insert(data).select().single();
    if (error) throw new Error(error.message);
    if (supabaseDown) { supabaseDown = false; void syncLocalToSupabase(); }
    return result as Record<string, unknown>;
  } catch (err) {
    if (isConnError(err)) {
      if (!supabaseDown) { supabaseDown = true; await telegram.alert('Supabase down — using SQLite fallback.'); }
      return localInsert(table, data);
    }
    throw err;
  }
}

export async function dbSelect(table: string, filters: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  let q = getSupabase().from(table).select('*');
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

// SQLite fallback
let _localDb: import('better-sqlite3').Database | null = null;

async function getLocalDb(): Promise<import('better-sqlite3').Database> {
  if (!_localDb) {
    const { default: Database } = await import('better-sqlite3');
    _localDb = new Database(`${process.env['HOME']}/cryptidvlog/local_fallback.db`);
    _localDb.exec(`CREATE TABLE IF NOT EXISTS pending_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL, operation TEXT NOT NULL,
      record_data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  return _localDb;
}

async function localInsert(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  logger.warn('Writing to SQLite fallback', { table });
  const db = await getLocalDb();
  db.prepare('INSERT INTO pending_sync (table_name, operation, record_data) VALUES (?, ?, ?)')
    .run(table, 'insert', JSON.stringify(data));
  return { ...data, _fallback: true };
}

export async function syncLocalToSupabase(): Promise<void> {
  const db = await getLocalDb();
  const pending = db.prepare('SELECT * FROM pending_sync').all() as Array<{
    id: number; table_name: string; record_data: string;
  }>;
  if (!pending.length) return;
  logger.info(`Syncing ${pending.length} local records to Supabase`);
  for (const r of pending) {
    try {
      await getSupabase().from(r.table_name).upsert(JSON.parse(r.record_data));
      db.prepare('DELETE FROM pending_sync WHERE id = ?').run(r.id);
    } catch { /* retry next time */ }
  }
}
