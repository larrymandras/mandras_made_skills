#!/usr/bin/env tsx
/**
 * Database migration runner for Caught on Camera.
 * Runs all SQL migrations in /migrations/ in order, skipping already-applied ones.
 * Seeds initial config data (FORMAT_SCHEDULE) if the config table exists.
 * Run: npm run setup-db
 *
 * Migration tracking: uses a `_migrations` table in Supabase (created if absent).
 *
 * Exit codes:
 *   0 — all migrations applied (or already up-to-date), seed complete
 *   1 — one or more migrations failed
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env['SUPABASE_URL'];
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(`${RED}SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env${RESET}`);
  console.error(`Run ${YELLOW}npm run check-env${RESET} first to validate all required variables.`);
  process.exit(1);
}

const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const projectRoot   = join(new URL('.', import.meta.url).pathname, '..');
const migrationsDir = join(projectRoot, 'migrations');

// ── Bootstrap migrations tracking table ───────────────────────────────────────

async function ensureMigrationsTable(): Promise<void> {
  // We attempt a simple select; if it errors with "does not exist" we create the table.
  const { error } = await sb.from('_migrations').select('name').limit(1);
  if (error && error.message.includes('does not exist')) {
    console.log(`  Creating ${CYAN}_migrations${RESET} tracking table…`);
    const createSql = `
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    const { error: createErr } = await (sb as unknown as {
      rpc: (fn: string, params: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    }).rpc('exec_sql', { sql: createSql });
    if (createErr) {
      // exec_sql may not exist — recommend Supabase CLI
      console.warn(`${YELLOW}  Could not auto-create _migrations table via exec_sql RPC.`);
      console.warn(`  Tip: Run migrations via Supabase CLI instead:  npx supabase db push${RESET}`);
    }
  }
}

// ── Load applied migrations ───────────────────────────────────────────────────

async function getAppliedMigrations(): Promise<Set<string>> {
  const { data, error } = await sb.from('_migrations').select('name');
  if (error) {
    // Table may not exist yet — return empty set
    if (error.message.includes('does not exist')) return new Set<string>();
    throw new Error(`Could not query _migrations: ${error.message}`);
  }
  return new Set((data ?? []).map((r: { name: string }) => r.name));
}

// ── Mark migration as applied ─────────────────────────────────────────────────

async function markApplied(name: string): Promise<void> {
  const { error } = await sb.from('_migrations').insert({ name });
  if (error && !error.message.includes('duplicate')) {
    console.warn(`  ${YELLOW}Warning: could not record migration ${name}: ${error.message}${RESET}`);
  }
}

// ── Execute raw SQL via RPC ───────────────────────────────────────────────────

async function executeSql(sql: string): Promise<void> {
  const { error } = await (sb as unknown as {
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  }).rpc('exec_sql', { sql });

  if (error) {
    throw new Error(error.message);
  }
}

// ── Default format schedule (matches src/config.ts) ──────────────────────────

const DEFAULT_FORMAT_SCHEDULE = JSON.stringify({
  '0': { format: 'operator_choice', category: '' },
  '1': { format: 'ring_cam',        category: 'animals' },
  '2': { format: 'body_cam',        category: 'night_patrol' },
  '3': { format: 'ring_cam',        category: 'compilation' },
  '4': { format: 'body_cam',        category: 'trail' },
  '5': { format: 'ring_cam',        category: 'paranormal' },
  '6': { format: 'body_cam',        category: 'compilation' },
});

// ── Seed config table ─────────────────────────────────────────────────────────

async function seedConfigTable(): Promise<void> {
  console.log(`\n${BOLD}Seeding config table…${RESET}`);

  // Check if config table exists
  const { error: checkErr } = await sb.from('config').select('key').limit(1);
  if (checkErr && checkErr.message.includes('does not exist')) {
    console.log(`  ${YELLOW}○${RESET} config table does not exist yet — skipping seed (will run after migration 001)`);
    return;
  }

  // Upsert FORMAT_SCHEDULE
  const { error } = await sb.from('config').upsert(
    { key: 'FORMAT_SCHEDULE', value: DEFAULT_FORMAT_SCHEDULE, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  if (error) {
    console.warn(`  ${YELLOW}Warning: could not seed FORMAT_SCHEDULE: ${error.message}${RESET}`);
  } else {
    console.log(`  ${GREEN}✓${RESET} FORMAT_SCHEDULE seeded`);
  }

  // Upsert budget defaults
  const budgetDefaults = [
    { key: 'BUDGET_HARD_CAP',   value: '50' },
    { key: 'BUDGET_WARNING',    value: '40' },
    { key: 'BUDGET_TARGET',     value: '25' },
    { key: 'MIN_BUFFER_DAYS',   value: '3' },
    { key: 'VIDEOS_PER_DAY',    value: '3' },
  ];
  for (const row of budgetDefaults) {
    const { error: e } = await sb.from('config').upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (e) {
      console.warn(`  ${YELLOW}Warning: could not seed ${row.key}: ${e.message}${RESET}`);
    } else {
      console.log(`  ${GREEN}✓${RESET} ${row.key} = ${row.value}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}=== Caught on Camera — Database Migration Runner ===${RESET}\n`);

if (!existsSync(migrationsDir)) {
  console.error(`${RED}migrations/ directory not found at ${migrationsDir}${RESET}`);
  process.exit(1);
}

// Collect all .sql files sorted lexicographically (001, 002, … order)
const migrationFiles = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

if (migrationFiles.length === 0) {
  console.warn(`${YELLOW}No .sql files found in ${migrationsDir}${RESET}`);
  process.exit(0);
}

console.log(`Found ${migrationFiles.length} migration file(s):\n`);
migrationFiles.forEach(f => console.log(`  ${CYAN}${f}${RESET}`));
console.log('');

// Ensure tracking table exists
await ensureMigrationsTable();

const applied = await getAppliedMigrations();

let ranCount    = 0;
let skippedCount = 0;
let failedCount  = 0;

for (const file of migrationFiles) {
  const label = file.replace('.sql', '');
  process.stdout.write(`  ${label}… `);

  if (applied.has(file)) {
    console.log(`${YELLOW}skipped${RESET}  (already applied)`);
    skippedCount++;
    continue;
  }

  const sqlPath = join(migrationsDir, file);
  const sql     = readFileSync(sqlPath, 'utf-8');

  try {
    await executeSql(sql);
    await markApplied(file);
    console.log(`${GREEN}✓ applied${RESET}`);
    ranCount++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}✗ FAILED${RESET}`);
    console.error(`    Error: ${msg}`);
    if (msg.includes('exec_sql') || msg.includes('function') || msg.includes('not exist')) {
      console.error(`\n${YELLOW}  Tip: The exec_sql RPC may not be set up on your Supabase project.`);
      console.error(`  Run migrations directly via Supabase CLI:  npx supabase db push${RESET}`);
    }
    failedCount++;
    // Continue trying remaining migrations so we report all failures at once
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`${BOLD}Migration summary:${RESET}`);
console.log(`  ${GREEN}Applied:  ${ranCount}${RESET}`);
console.log(`  ${YELLOW}Skipped:  ${skippedCount}${RESET}  (already up-to-date)`);
if (failedCount > 0) {
  console.log(`  ${RED}Failed:   ${failedCount}${RESET}`);
}

if (failedCount > 0) {
  console.error(`\n${RED}${BOLD}Migration run had failures. Fix errors above, then re-run.${RESET}\n`);
  process.exit(1);
}

// Seed config data
await seedConfigTable();

console.log(`\n${GREEN}${BOLD}All migrations complete.${RESET}`);
console.log(`${YELLOW}Verify tables in Supabase dashboard, then run: npm run smoke-test${RESET}\n`);
