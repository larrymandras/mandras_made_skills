#!/usr/bin/env tsx
/**
 * Smoke test — checks all integrations are reachable before first pipeline run.
 * Run: npm run smoke-test
 */
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../src/config.js';
import { telegram } from '../src/monitoring/telegram.js';

let allPass = true;

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log('✓');
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    allPass = false;
  }
}

console.log('Running smoke tests...\n');

await check('Supabase connection', async () => {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const { error } = await sb.from('characters').select('name').limit(1);
  if (error) throw new Error(error.message);
});

await check('Characters seeded (yeti + bigfoot)', async () => {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const { data, error } = await sb.from('characters').select('name');
  if (error) throw new Error(error.message);
  const names = (data ?? []).map((r: { name: string }) => r.name);
  if (!names.includes('yeti')) throw new Error('yeti not seeded');
  if (!names.includes('bigfoot')) throw new Error('bigfoot not seeded');
});

await check('Anthropic API reachable', async () => {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 5,
    messages: [{ role: 'user', content: 'ping' }],
  });
});

await check('Telegram bot operational', async () => {
  await telegram.info('Smoke test ping — all systems go');
});

await check('Assets directory accessible', async () => {
  const { readdirSync } = await import('fs');
  const { join } = await import('path');
  const musicDir = join(new URL('.', import.meta.url).pathname, '../assets/music');
  readdirSync(musicDir); // throws if missing
});

console.log(allPass
  ? '\n✓ All smoke tests passed — ready to run pipeline'
  : '\n✗ Some tests failed — fix issues before running pipeline');

if (!allPass) process.exit(1);
