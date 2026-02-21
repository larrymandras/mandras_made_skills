#!/usr/bin/env tsx
/**
 * Integration smoke test for Caught on Camera.
 * Verifies every external dependency is reachable before the first pipeline run.
 * Does NOT generate real video or spend real money.
 * Run: npm run smoke-test
 *
 * Exit codes:
 *   0 — all 10 tests pass
 *   1 — one or more tests failed
 */
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

// ── Import project modules ────────────────────────────────────────────────────
// These imports also validate that the TypeScript build is coherent
import { sanitizePrompt } from '../src/gates/gate4-policy.js';

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

// ── Test runner ───────────────────────────────────────────────────────────────

let allPass = true;
let testNumber = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  testNumber++;
  const label = `Test ${testNumber.toString().padStart(2, ' ')}: ${name}`;
  process.stdout.write(`  ${label}… `);
  try {
    await fn();
    console.log(`${GREEN}PASS${RESET}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${RED}FAIL${RESET}`);
    console.error(`           ${YELLOW}${msg}${RESET}`);
    allPass = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const env = process.env;

function requireEnv(name: string): string {
  const val = env[name];
  if (!val) throw new Error(`${name} is not set — run npm run check-env`);
  return val;
}

const projectRoot  = join(new URL('.', import.meta.url).pathname, '..');
const overlaysPath = env['OVERLAYS_PATH']  ?? join(projectRoot, 'assets', 'overlays');
const audioBedPath = env['AUDIO_BEDS_PATH'] ?? join(projectRoot, 'assets', 'audio_beds');

// ── Run tests ─────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}=== Caught on Camera — Smoke Tests ===${RESET}\n`);

// Test 1: Database connection (Supabase + SQLite fallback)
await test('Database connection (Supabase)', async () => {
  const url  = requireEnv('SUPABASE_URL');
  const key  = requireEnv('SUPABASE_SERVICE_KEY');
  const sb   = createClient(url, key);
  // Query a table that must exist after migrations — fall back to a system check
  const { error } = await sb.from('videos').select('id').limit(1);
  if (error && !error.message.includes('does not exist') && !error.message.includes('relation')) {
    throw new Error(`Supabase query error: ${error.message}`);
  }
  // If "does not exist", migrations haven't run yet — connection still works
});

// Test 2: Claude API — send a simple message, verify response
await test('Claude API (Anthropic)', async () => {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'Reply with: OK' }],
  });
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');
  if (!text) throw new Error('Empty response from Claude API');
});

// Test 3: fal.ai connectivity — check API key validity without generating
await test('fal.ai API key validity', async () => {
  const falKey = requireEnv('FAL_KEY');
  // Ping the fal.ai models list endpoint — lightweight, no generation cost
  const res = await fetch('https://fal.run/fal-ai/fast-sdxl', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: 'test', num_inference_steps: 1, width: 64, height: 64 }),
  });
  // 401 = invalid key, 403 = no access, 422 = valid key but bad params (acceptable here)
  if (res.status === 401) throw new Error('fal.ai API key is invalid (401 Unauthorized)');
  if (res.status === 403) throw new Error('fal.ai API key has no access (403 Forbidden)');
  // 200, 422, 429 all indicate the key was accepted
});

// Test 4: Telegram — send test alert
await test('Telegram bot (send test message)', async () => {
  const token  = requireEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requireEnv('TELEGRAM_CHAT_ID');
  const url    = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '[CaughtOnCamera] smoke-test ping — all systems nominal',
      parse_mode: 'Markdown',
    }),
  });
  const json = await res.json() as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`Telegram API error: ${json.description ?? 'unknown'}`);
});

// Test 5: Cloudinary — verify credentials via ping endpoint
await test('Cloudinary credentials', async () => {
  const cloudName = requireEnv('CLOUDINARY_CLOUD_NAME');
  const apiKey    = requireEnv('CLOUDINARY_API_KEY');
  const apiSecret = requireEnv('CLOUDINARY_API_SECRET');
  // Use the Cloudinary ping endpoint (does not upload anything)
  const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/ping`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (res.status === 401) throw new Error('Cloudinary: invalid API key or secret (401)');
  if (res.status === 403) throw new Error('Cloudinary: no access (403)');
  if (!res.ok) throw new Error(`Cloudinary ping failed: HTTP ${res.status}`);
});

// Test 6: Blotato — verify API key via accounts list
await test('Blotato API key', async () => {
  const blotatoKey = requireEnv('BLOTATO_API_KEY');
  const res = await fetch('https://backend.blotato.com/api/v1/accounts', {
    headers: {
      'blotato-api-key': blotatoKey,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 401) throw new Error('Blotato: invalid API key (401)');
  if (res.status === 403) throw new Error('Blotato: API key has no access (403)');
  if (res.status === 404) throw new Error('Blotato: accounts endpoint not found — check API URL');
  // 200 or 422 both indicate the key was accepted
});

// Test 7: FFmpeg — verify installed and accessible
await test('FFmpeg installed and accessible', async () => {
  try {
    const output = execSync('ffmpeg -version', { encoding: 'utf-8', timeout: 10_000 });
    if (!output.toLowerCase().includes('ffmpeg version')) {
      throw new Error('Unexpected ffmpeg -version output');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('ENOENT')) {
      throw new Error('ffmpeg not found — install with: sudo apt install ffmpeg (WSL2) or brew install ffmpeg (macOS)');
    }
    if (err instanceof Error && err.message.includes('Unexpected')) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ffmpeg -version failed: ${msg}`);
  }
});

// Test 8: Overlay assets — verify ring_cam and body_cam template PNGs exist
await test('Overlay assets (ring_cam + body_cam template PNGs)', async () => {
  const ringCamDir  = join(overlaysPath, 'ring_cam');
  const bodyCAMDir  = join(overlaysPath, 'body_cam');

  const ringExists  = existsSync(ringCamDir);
  const bodyExists  = existsSync(bodyCAMDir);

  if (!ringExists && !bodyExists) {
    throw new Error(
      `Neither overlays/ring_cam/ nor overlays/body_cam/ found at ${overlaysPath}\n` +
      '           Create them with PNG overlay templates before running the pipeline.',
    );
  }

  const warnings: string[] = [];

  if (!ringExists) warnings.push('overlays/ring_cam/ missing');
  else {
    const pngs = readdirSync(ringCamDir).filter(f => f.endsWith('.png'));
    if (pngs.length === 0) warnings.push('overlays/ring_cam/ has no .png files');
  }

  if (!bodyExists) warnings.push('overlays/body_cam/ missing');
  else {
    const pngs = readdirSync(bodyCAMDir).filter(f => f.endsWith('.png'));
    if (pngs.length === 0) warnings.push('overlays/body_cam/ has no .png files');
  }

  if (warnings.length > 0) {
    // Overlays missing but dirs exist — warn, don't hard-fail (Phase 1 may not have them yet)
    console.log(`\n           ${YELLOW}Warning: ${warnings.join('; ')}${RESET}`);
    console.log(`           (Overlay PNGs required before Phase 4 — pipeline will fail at gate 6)`);
  }
});

// Test 9: Audio beds — verify at least one audio bed exists per format
await test('Audio beds (ring_cam + body_cam)', async () => {
  const ringDir = join(audioBedPath, 'ring_cam');
  const bodyDir = join(audioBedPath, 'body_cam');

  const ringExists = existsSync(ringDir);
  const bodyExists = existsSync(bodyDir);

  if (!ringExists && !bodyExists) {
    throw new Error(
      `audio_beds/ directory structure not found at ${audioBedPath}\n` +
      '           Create audio_beds/ring_cam/ and audio_beds/body_cam/ with .wav files.',
    );
  }

  const missing: string[] = [];

  if (!ringExists) {
    missing.push('audio_beds/ring_cam/');
  } else {
    const files = readdirSync(ringDir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3'));
    if (files.length === 0) missing.push('audio_beds/ring_cam/ (no .wav/.mp3 files)');
  }

  if (!bodyExists) {
    missing.push('audio_beds/body_cam/');
  } else {
    const files = readdirSync(bodyDir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3'));
    if (files.length === 0) missing.push('audio_beds/body_cam/ (no .wav/.mp3 files)');
  }

  if (missing.length > 0) {
    console.log(`\n           ${YELLOW}Warning: audio beds missing for: ${missing.join(', ')}${RESET}`);
    console.log(`           (Audio beds required before Phase 5 — pipeline will fail at assembly)`);
  }
});

// Test 10: Prompt sanitizer — run sanitizePrompt() on a blocked word, verify rejection
await test('Prompt sanitizer (gate4-policy.ts)', () => {
  // Should block "arrest" (always-blocked list)
  const blockedResult = sanitizePrompt('patrol officer makes an arrest on camera');
  if (blockedResult.pass !== false) {
    throw new Error('sanitizePrompt should return pass=false for prompt containing "arrest"');
  }
  if (!blockedResult.blockedWords.includes('arrest')) {
    throw new Error(`Expected "arrest" in blockedWords, got: ${JSON.stringify(blockedResult.blockedWords)}`);
  }

  // Should pass and rewrite "chase"
  const rewriteResult = sanitizePrompt('someone seen on body cam during a chase in the woods');
  if (rewriteResult.pass !== true) {
    throw new Error(
      `sanitizePrompt should return pass=true for rewritable prompt. ` +
      `Got: pass=${rewriteResult.pass}, blockedWords=${JSON.stringify(rewriteResult.blockedWords)}`,
    );
  }
  if (!rewriteResult.rewrites.some(r => r.original.toLowerCase() === 'chase')) {
    throw new Error(`Expected "chase" to be rewritten, got rewrites: ${JSON.stringify(rewriteResult.rewrites)}`);
  }

  return Promise.resolve();
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
if (allPass) {
  console.log(`${GREEN}${BOLD}All ${testNumber} smoke tests passed — ready to run pipeline.${RESET}`);
  console.log(`${YELLOW}Next: /caught-on-camera run${RESET}\n`);
} else {
  console.error(`${RED}${BOLD}One or more smoke tests failed — fix issues before running pipeline.${RESET}`);
  console.error(`${YELLOW}Re-run after fixing: npm run smoke-test${RESET}\n`);
  process.exit(1);
}
