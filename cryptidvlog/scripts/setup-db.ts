#!/usr/bin/env tsx
/**
 * Run all SQL migrations against Supabase in order.
 * Run: npm run setup-db
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { env } from '../src/config.js';

const migrationsDir = join(new URL('.', import.meta.url).pathname, '../migrations');
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log(`Running ${files.length} migrations...\n`);

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf-8');
  process.stdout.write(`  ${file}... `);
  // Execute via raw SQL (requires pg_execute or similar Supabase RPC)
  // In production: use supabase CLI `supabase db push` instead
  const { error } = await (supabase as unknown as { rpc: (name: string, params: Record<string, unknown>) => Promise<{ error: { message: string } | null }> })
    .rpc('exec_sql', { sql });
  if (error) {
    console.error(`FAILED\n  Error: ${error.message}`);
    console.error('\nTip: Run migrations via Supabase CLI: npx supabase db push');
    process.exit(1);
  }
  console.log('✓');
}

console.log('\n✓ All migrations complete');
