#!/usr/bin/env tsx
/**
 * Pre-flight environment validation for Caught on Camera.
 * Checks all required env vars, asset directories, Supabase connection, and Telegram bot.
 * Run: npm run check-env
 *
 * Exit codes:
 *   0 — all required checks pass
 *   1 — one or more required checks failed
 */
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

// ── ANSI color helpers ────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

const pass = (label: string, detail = '') =>
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? `  ${YELLOW}${detail}${RESET}` : ''}`);

const fail = (label: string, hint = '') => {
  console.error(`  ${RED}✗${RESET} ${label}${hint ? `\n    ${YELLOW}hint: ${hint}${RESET}` : ''}`);
};

// ── Result tracking ───────────────────────────────────────────────────────────

let anyRequiredFailed = false;

function checkRequired(label: string, value: string | undefined, hint?: string): void {
  if (value && value.trim().length > 0) {
    // Mask secrets: show first 6 chars + ellipsis
    const display = value.length > 10 ? `${value.slice(0, 6)}…` : '(set)';
    pass(label, display);
  } else {
    fail(label, hint ?? `Set ${label} in .env`);
    anyRequiredFailed = true;
  }
}

// ── Section: Required environment variables ───────────────────────────────────

console.log(`\n${BOLD}=== Caught on Camera — Pre-flight Check ===${RESET}\n`);
console.log(`${BOLD}[ 1 ] Required environment variables${RESET}`);

// AI / Generation
checkRequired('FAL_KEY',           process.env['FAL_KEY'],           'Get from https://fal.ai/dashboard');
checkRequired('ANTHROPIC_API_KEY', process.env['ANTHROPIC_API_KEY'], 'Get from https://console.anthropic.com');

// Database
checkRequired('SUPABASE_URL',         process.env['SUPABASE_URL'],         'Get from Supabase project settings → API');
checkRequired('SUPABASE_ANON_KEY',    process.env['SUPABASE_ANON_KEY'],    'Get from Supabase project settings → API');
checkRequired('SUPABASE_SERVICE_KEY', process.env['SUPABASE_SERVICE_KEY'], 'Get from Supabase project settings → API → service_role key');

// CDN / Storage
checkRequired('CLOUDINARY_CLOUD_NAME', process.env['CLOUDINARY_CLOUD_NAME'], 'Get from https://cloudinary.com/console');
checkRequired('CLOUDINARY_API_KEY',    process.env['CLOUDINARY_API_KEY'],    'Get from Cloudinary console');
checkRequired('CLOUDINARY_API_SECRET', process.env['CLOUDINARY_API_SECRET'], 'Get from Cloudinary console');

// Telegram
checkRequired('TELEGRAM_BOT_TOKEN', process.env['TELEGRAM_BOT_TOKEN'], 'Create bot via @BotFather on Telegram');
checkRequired('TELEGRAM_CHAT_ID',   process.env['TELEGRAM_CHAT_ID'],   'Add bot to channel; run /get_id');

// Publishing
checkRequired('BLOTATO_API_KEY',               process.env['BLOTATO_API_KEY'],               'Get from https://blotato.com/settings');
checkRequired('BLOTATO_YOUTUBE_ACCOUNT_ID',    process.env['BLOTATO_YOUTUBE_ACCOUNT_ID'],    'Get from Blotato connected accounts');
checkRequired('BLOTATO_INSTAGRAM_ACCOUNT_ID',  process.env['BLOTATO_INSTAGRAM_ACCOUNT_ID'],  'Get from Blotato connected accounts');
checkRequired('BLOTATO_TIKTOK_ACCOUNT_ID',     process.env['BLOTATO_TIKTOK_ACCOUNT_ID'],     'Get from Blotato connected accounts');

// ── Section: Optional / derived vars ─────────────────────────────────────────

console.log(`\n${BOLD}[ 2 ] Optional / configuration variables${RESET}`);

function checkOptional(label: string, value: string | undefined, defaultVal: string): void {
  const effective = value ?? defaultVal;
  console.log(`  ${YELLOW}○${RESET} ${label}  ${effective}${value ? '' : '  (default)'}`);
}

checkOptional('ENABLE_POLICE_SUBTYPE',    process.env['ENABLE_POLICE_SUBTYPE'],    'true');
checkOptional('DAILY_BUDGET_HARD_CAP',   process.env['DAILY_BUDGET_HARD_CAP'],   '50');
checkOptional('DAILY_BUDGET_WARNING',    process.env['DAILY_BUDGET_WARNING'],    '40');
checkOptional('DAILY_BUDGET_TARGET',     process.env['DAILY_BUDGET_TARGET'],     '25');
checkOptional('VIDEOS_PER_DAY',          process.env['VIDEOS_PER_DAY'],          '3');
checkOptional('MIN_BUFFER_DAYS',         process.env['MIN_BUFFER_DAYS'],         '3');
checkOptional('TEMP_DIR',                process.env['TEMP_DIR'],                '/tmp/caughtoncamera');
checkOptional('LOG_LEVEL',               process.env['LOG_LEVEL'],               'info');

// ── Section: Asset directories ────────────────────────────────────────────────

console.log(`\n${BOLD}[ 3 ] Asset directories${RESET}`);

// Resolve asset paths. OVERLAYS_PATH and AUDIO_BEDS_PATH may be set in env
// or we fall back to the standard project-relative location.
const projectRoot = join(new URL('.', import.meta.url).pathname, '..');

const overlaysPath  = process.env['OVERLAYS_PATH']   ?? join(projectRoot, 'assets', 'overlays');
const audioBedPath  = process.env['AUDIO_BEDS_PATH']  ?? join(projectRoot, 'assets', 'audio_beds');

function checkDir(label: string, dirPath: string, required = true): boolean {
  if (existsSync(dirPath)) {
    pass(label, dirPath);
    return true;
  } else {
    if (required) {
      fail(label, `Create: mkdir -p "${dirPath}"`);
      anyRequiredFailed = true;
    } else {
      console.log(`  ${YELLOW}○${RESET} ${label}  (missing — optional)`);
    }
    return false;
  }
}

const overlaysOk  = checkDir('overlays/ directory',           overlaysPath);
const audioBedsOk = checkDir('audio_beds/ directory',         audioBedPath);

if (overlaysOk) {
  checkDir('overlays/ring_cam/ subdirectory', join(overlaysPath, 'ring_cam'));
  checkDir('overlays/body_cam/ subdirectory', join(overlaysPath, 'body_cam'));
  // Sub-type overlays — optional but warn if missing
  const bodyCamSubTypes = ['police_security', 'hiker_trail', 'dashcam', 'helmet_action'];
  for (const subType of bodyCamSubTypes) {
    const subPath = join(overlaysPath, 'body_cam', subType);
    if (!existsSync(subPath)) {
      console.log(`  ${YELLOW}○${RESET} overlays/body_cam/${subType}/  (not yet created — needed before Phase 4)`);
    } else {
      pass(`overlays/body_cam/${subType}/`, subPath);
    }
  }

  // Check ring_cam overlay PNGs
  const ringCamDir = join(overlaysPath, 'ring_cam');
  if (existsSync(ringCamDir)) {
    const pngs = readdirSync(ringCamDir).filter(f => f.endsWith('.png'));
    if (pngs.length > 0) {
      pass(`ring_cam overlay PNGs found`, `${pngs.length} file(s): ${pngs.slice(0, 3).join(', ')}${pngs.length > 3 ? '…' : ''}`);
    } else {
      console.log(`  ${YELLOW}○${RESET} ring_cam overlay PNGs  (directory exists but no .png files yet)`);
    }
  }
}

if (audioBedsOk) {
  checkDir('audio_beds/ring_cam/ subdirectory', join(audioBedPath, 'ring_cam'));
  checkDir('audio_beds/body_cam/ subdirectory', join(audioBedPath, 'body_cam'));

  // Verify at least one WAV/MP3 per format
  for (const format of ['ring_cam', 'body_cam']) {
    const formatDir = join(audioBedPath, format);
    if (existsSync(formatDir)) {
      const audioFiles = readdirSync(formatDir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3'));
      if (audioFiles.length > 0) {
        pass(`audio_beds/${format}/ has audio files`, `${audioFiles.length} file(s)`);
      } else {
        console.log(`  ${YELLOW}○${RESET} audio_beds/${format}/  (exists but no .wav/.mp3 files yet — add before Phase 5)`);
      }
    }
  }
}

// ── Section: Supabase connection ──────────────────────────────────────────────

console.log(`\n${BOLD}[ 4 ] Supabase connection${RESET}`);

const supabaseUrl  = process.env['SUPABASE_URL'];
const supabaseKey  = process.env['SUPABASE_SERVICE_KEY'];

if (supabaseUrl && supabaseKey) {
  process.stdout.write(`  Testing Supabase connection… `);
  try {
    const sb = createClient(supabaseUrl, supabaseKey);
    // A simple query to test connectivity — intentionally selecting a system-level table
    const { error } = await sb.rpc('version');
    if (error && !error.message.includes('does not exist')) {
      // rpc('version') may not exist — try a simple select instead
      const { error: e2 } = await sb.from('videos').select('id').limit(1);
      if (e2 && !e2.message.includes('does not exist') && !e2.message.includes('relation')) {
        throw new Error(e2.message);
      }
    }
    console.log(`${GREEN}✓${RESET}  connected`);
  } catch (err) {
    console.log(`${RED}✗${RESET}`);
    fail('Supabase connection failed', err instanceof Error ? err.message : String(err));
    anyRequiredFailed = true;
  }
} else {
  console.log(`  ${YELLOW}○${RESET} Supabase connection  (skipped — credentials missing above)`);
}

// ── Section: Telegram bot ─────────────────────────────────────────────────────

console.log(`\n${BOLD}[ 5 ] Telegram bot${RESET}`);

const tgToken  = process.env['TELEGRAM_BOT_TOKEN'];
const tgChatId = process.env['TELEGRAM_CHAT_ID'];

if (tgToken && tgChatId) {
  process.stdout.write(`  Sending Telegram test message… `);
  try {
    const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgChatId,
        text: '[CaughtOnCamera] check-env: pre-flight test — OK',
        parse_mode: 'Markdown',
      }),
    });
    const json = await res.json() as { ok: boolean; description?: string };
    if (!json.ok) throw new Error(json.description ?? 'Telegram API returned ok: false');
    console.log(`${GREEN}✓${RESET}  message sent — check your channel`);
  } catch (err) {
    console.log(`${RED}✗${RESET}`);
    fail('Telegram test message failed', err instanceof Error ? err.message : String(err));
    anyRequiredFailed = true;
  }
} else {
  console.log(`  ${YELLOW}○${RESET} Telegram test  (skipped — credentials missing above)`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
if (anyRequiredFailed) {
  console.error(`${RED}${BOLD}FAILED — one or more required checks did not pass.${RESET}`);
  console.error(`${YELLOW}Fix the issues above, then re-run: npm run check-env${RESET}\n`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}PASSED — all required checks complete.${RESET}`);
  console.log(`${YELLOW}Next: npm run setup-db${RESET}\n`);
}
