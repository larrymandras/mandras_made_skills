/**
 * Database client — Supabase primary, SQLite local fallback.
 *
 * On recovery (Supabase comes back online) any writes that were queued in
 * SQLite are automatically replayed via syncPendingToSupabase().
 *
 * Mirrors the pattern used in cryptidvlog/src/db/client.ts.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import { telegram } from '../monitoring/telegram.js';

// ─── Supabase singleton ───────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;
let supabaseDown = false;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  }
  return _supabase;
}

/** Exported for cases where a raw Supabase client is needed (e.g., RPC calls). */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return getSupabase()[prop as keyof SupabaseClient];
  },
});

// ─── Connection error detection ───────────────────────────────────────────────

function isConnError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes('ECONNREFUSED') ||
      err.message.includes('fetch failed') ||
      err.message.includes('network timeout') ||
      err.message.includes('ETIMEDOUT'))
  );
}

// ─── Generic CRUD helpers ─────────────────────────────────────────────────────

export async function dbInsert(
  table: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const { data: result, error } = await getSupabase()
      .from(table)
      .insert(data)
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (supabaseDown) {
      supabaseDown = false;
      void syncPendingToSupabase();
    }
    return result as Record<string, unknown>;
  } catch (err) {
    if (isConnError(err)) {
      if (!supabaseDown) {
        supabaseDown = true;
        await telegram.alert('Supabase down — using SQLite fallback for caught_on_camera.');
      }
      return localInsert(table, data);
    }
    throw err;
  }
}

export async function dbSelect(
  table: string,
  filters: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  try {
    let q = getSupabase().from(table).select('*');
    for (const [k, v] of Object.entries(filters)) {
      q = q.eq(k, v);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Record<string, unknown>[];
  } catch (err) {
    if (isConnError(err)) {
      logger.warn('Supabase unavailable for SELECT — returning empty result', { table });
      return [];
    }
    throw err;
  }
}

export async function dbUpdate(
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const { data: result, error } = await getSupabase()
      .from(table)
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (supabaseDown) {
      supabaseDown = false;
      void syncPendingToSupabase();
    }
    return result as Record<string, unknown>;
  } catch (err) {
    if (isConnError(err)) {
      if (!supabaseDown) {
        supabaseDown = true;
        await telegram.alert('Supabase down — UPDATE queued in SQLite fallback.');
      }
      return localUpdate(table, id, data);
    }
    throw err;
  }
}

/**
 * Flexible SELECT with arbitrary filter operations (gt, lt, gte, lte, in, etc.).
 * Useful for time-range and virality-score queries.
 */
export async function dbSelectFiltered(
  table: string,
  build: (
    q: ReturnType<SupabaseClient['from']>,
  ) => ReturnType<SupabaseClient['from']>,
): Promise<Record<string, unknown>[]> {
  try {
    const q = build(getSupabase().from(table).select('*'));
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Record<string, unknown>[];
  } catch (err) {
    if (isConnError(err)) {
      logger.warn('Supabase unavailable for filtered SELECT — returning empty result', { table });
      return [];
    }
    throw err;
  }
}

// ─── SQLite fallback ──────────────────────────────────────────────────────────

let _localDb: import('better-sqlite3').Database | null = null;

async function getDb(): Promise<import('better-sqlite3').Database> {
  if (!_localDb) {
    const { default: Database } = await import('better-sqlite3');
    const dbPath = `${process.env['HOME'] ?? '/tmp'}/caught_on_camera/local_fallback.db`;
    _localDb = new Database(dbPath);
    _localDb.exec(`
      CREATE TABLE IF NOT EXISTS pending_sync (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name  TEXT    NOT NULL,
        operation   TEXT    NOT NULL,
        record_id   TEXT,
        record_data TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
  return _localDb;
}

/** Exported alias so callers can use getDb() for direct SQLite access if needed. */
export { getDb };

async function localInsert(
  table: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  logger.warn('Writing INSERT to SQLite fallback', { table });
  const db = await getDb();
  db.prepare(
    'INSERT INTO pending_sync (table_name, operation, record_id, record_data) VALUES (?, ?, ?, ?)',
  ).run(table, 'insert', (data['id'] as string) ?? null, JSON.stringify(data));
  return { ...data, _fallback: true };
}

async function localUpdate(
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  logger.warn('Writing UPDATE to SQLite fallback', { table, id });
  const db = await getDb();
  db.prepare(
    'INSERT INTO pending_sync (table_name, operation, record_id, record_data) VALUES (?, ?, ?, ?)',
  ).run(table, 'update', id, JSON.stringify({ id, ...data }));
  return { id, ...data, _fallback: true };
}

// ─── Sync recovery ────────────────────────────────────────────────────────────

export async function syncPendingToSupabase(): Promise<void> {
  const db = await getDb();
  const pending = db.prepare('SELECT * FROM pending_sync ORDER BY id ASC').all() as Array<{
    id: number;
    table_name: string;
    operation: string;
    record_id: string | null;
    record_data: string;
  }>;

  if (!pending.length) return;

  logger.info(`Syncing ${pending.length} local SQLite record(s) to Supabase`);

  for (const row of pending) {
    try {
      const payload = JSON.parse(row.record_data) as Record<string, unknown>;

      if (row.operation === 'insert') {
        await getSupabase().from(row.table_name).upsert(payload);
      } else if (row.operation === 'update' && row.record_id) {
        await getSupabase()
          .from(row.table_name)
          .update(payload)
          .eq('id', row.record_id);
      }

      db.prepare('DELETE FROM pending_sync WHERE id = ?').run(row.id);
    } catch (err) {
      logger.warn('Sync retry failed — will retry on next recovery', {
        id: row.id,
        table: row.table_name,
        err,
      });
      // Do not rethrow — leave in queue for the next recovery cycle
    }
  }

  const remaining = (
    db.prepare('SELECT COUNT(*) as cnt FROM pending_sync').get() as { cnt: number }
  ).cnt;

  if (remaining === 0) {
    logger.info('SQLite sync queue fully drained — Supabase is current');
  } else {
    logger.warn(`${remaining} record(s) still pending sync`);
  }
}
