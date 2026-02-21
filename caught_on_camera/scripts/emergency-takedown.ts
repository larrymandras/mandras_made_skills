#!/usr/bin/env tsx
/**
 * Emergency multi-platform content removal for Caught on Camera.
 * Accepts a video ID or "all" to remove from all platforms immediately.
 *
 * Usage:
 *   npm run emergency-takedown -- <video-id>
 *   npm run emergency-takedown -- all
 *   npm run emergency-takedown -- <video-id> --dry-run
 *   npm run emergency-takedown -- all --dry-run
 *
 * Flags:
 *   --dry-run    Show what would be taken down without doing it
 *
 * Exit codes:
 *   0 — takedown complete (or dry-run complete)
 *   1 — usage error or one or more platforms failed
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

// ── Parse CLI arguments ───────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
// First positional arg (not a flag) is the video ID or "all"
const videoArg = args.find(a => !a.startsWith('--'));

if (!videoArg) {
  console.error(`\n${RED}Usage:${RESET}`);
  console.error(`  npm run emergency-takedown -- <video-id>   — take down one video`);
  console.error(`  npm run emergency-takedown -- all           — take down ALL published videos`);
  console.error(`  npm run emergency-takedown -- <video-id> --dry-run`);
  console.error(`  npm run emergency-takedown -- all --dry-run\n`);
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env['SUPABASE_URL'];
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_KEY'];
const BLOTATO_API_KEY      = process.env['BLOTATO_API_KEY'];
const TELEGRAM_BOT_TOKEN   = process.env['TELEGRAM_BOT_TOKEN'];
const TELEGRAM_CHAT_ID     = process.env['TELEGRAM_CHAT_ID'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(`${RED}SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.${RESET}`);
  process.exit(1);
}

const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Types ─────────────────────────────────────────────────────────────────────

type Platform = 'youtube' | 'tiktok' | 'instagram' | 'shorts';

interface PlatformPublish {
  video_id: string;
  platform: Platform;
  platform_video_id: string;
  blotato_post_id: string | null;
  published_at: string | null;
}

interface VideoRecord {
  id: string;
  title: string | null;
  status: string;
  format: string;
}

// ── Telegram alert ────────────────────────────────────────────────────────────

async function sendTelegramAlert(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
    });
  } catch {
    // Non-fatal — takedown already logged to DB
  }
}

// ── Platform delete via Blotato ───────────────────────────────────────────────

async function deleteBlotatoPost(blotatoPostId: string): Promise<void> {
  if (!BLOTATO_API_KEY) throw new Error('BLOTATO_API_KEY not set');
  const res = await fetch(`https://backend.blotato.com/api/v1/posts/${blotatoPostId}`, {
    method: 'DELETE',
    headers: {
      'blotato-api-key': BLOTATO_API_KEY,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 404) return; // Already removed
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Blotato DELETE returned HTTP ${res.status}: ${body}`);
  }
}

// ── Platform delete fallbacks (direct API calls) ──────────────────────────────

async function deleteFromYouTube(platformVideoId: string): Promise<void> {
  // YouTube Data API v3 videos.delete
  // In production: use OAuth token from env / token store
  const accessToken = process.env['YOUTUBE_ACCESS_TOKEN'];
  if (!accessToken) throw new Error('YOUTUBE_ACCESS_TOKEN not set — cannot delete directly');
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?id=${platformVideoId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 204 || res.status === 404) return;
  if (!res.ok) throw new Error(`YouTube delete failed: HTTP ${res.status}`);
}

async function deleteFromTikTok(platformVideoId: string): Promise<void> {
  const accessToken = process.env['TIKTOK_ACCESS_TOKEN'];
  if (!accessToken) throw new Error('TIKTOK_ACCESS_TOKEN not set — cannot delete directly');
  const res = await fetch('https://open.tiktokapis.com/v2/video/delete/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: platformVideoId }),
  });
  if (!res.ok && res.status !== 404) throw new Error(`TikTok delete failed: HTTP ${res.status}`);
}

async function deleteFromInstagram(platformVideoId: string): Promise<void> {
  const accessToken = process.env['INSTAGRAM_ACCESS_TOKEN'];
  if (!accessToken) throw new Error('INSTAGRAM_ACCESS_TOKEN not set — cannot delete directly');
  const res = await fetch(
    `https://graph.instagram.com/${platformVideoId}?access_token=${accessToken}`,
    { method: 'DELETE' },
  );
  if (res.status === 200 || res.status === 404) return;
  if (!res.ok) throw new Error(`Instagram delete failed: HTTP ${res.status}`);
}

async function deleteFromShorts(platformVideoId: string): Promise<void> {
  // YouTube Shorts share the same API as YouTube videos
  await deleteFromYouTube(platformVideoId);
}

// ── Per-platform dispatch ─────────────────────────────────────────────────────

async function deletePlatformPost(pub: PlatformPublish): Promise<void> {
  // Try Blotato first (single API call handles any platform it manages)
  if (pub.blotato_post_id && BLOTATO_API_KEY) {
    await deleteBlotatoPost(pub.blotato_post_id);
    return;
  }
  // Fall back to direct platform API
  switch (pub.platform) {
    case 'youtube':   await deleteFromYouTube(pub.platform_video_id);   break;
    case 'tiktok':    await deleteFromTikTok(pub.platform_video_id);    break;
    case 'instagram': await deleteFromInstagram(pub.platform_video_id); break;
    case 'shorts':    await deleteFromShorts(pub.platform_video_id);    break;
    default:
      throw new Error(`Unknown platform: ${pub.platform}`);
  }
}

// ── Take down a single video ──────────────────────────────────────────────────

async function takedownVideo(video: VideoRecord): Promise<{ removed: Platform[]; failed: Platform[] }> {
  const { data: publishes, error } = await sb
    .from('platform_publishes')
    .select('video_id, platform, platform_video_id, blotato_post_id, published_at')
    .eq('video_id', video.id);

  if (error) throw new Error(`Could not fetch platform_publishes: ${error.message}`);

  const pubs     = (publishes ?? []) as PlatformPublish[];
  const removed: Platform[] = [];
  const failed: Platform[]  = [];

  if (pubs.length === 0) {
    console.log(`  ${DIM}No platform publish records found for ${video.id}${RESET}`);
    return { removed, failed };
  }

  for (const pub of pubs) {
    const label = `    ${pub.platform.padEnd(12)} (id: ${pub.platform_video_id})`;
    if (isDryRun) {
      console.log(`${YELLOW}[DRY-RUN]${RESET}${label}  — would delete`);
      continue;
    }
    process.stdout.write(`${label}… `);
    try {
      await deletePlatformPost(pub);
      console.log(`${GREEN}✓ removed${RESET}`);
      removed.push(pub.platform);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${RED}✗ FAILED${RESET}  ${msg}`);
      failed.push(pub.platform);
    }
  }

  if (!isDryRun) {
    // Mark video status in DB
    await sb
      .from('videos')
      .update({ status: 'taken_down', taken_down_at: new Date().toISOString() })
      .eq('id', video.id);

    // Write takedown log entry
    await sb.from('takedown_log').insert({
      video_id:          video.id,
      platforms_removed: removed,
      platforms_failed:  failed,
      reason:            'emergency-takedown script',
      completed_at:      new Date().toISOString(),
    });
  }

  return { removed, failed };
}

// ── Resolve target videos ─────────────────────────────────────────────────────

async function resolveTargetVideos(): Promise<VideoRecord[]> {
  if (videoArg === 'all') {
    const { data, error } = await sb
      .from('videos')
      .select('id, title, status, format')
      .in('status', ['published', 'approved']);
    if (error) throw new Error(`Could not fetch videos: ${error.message}`);
    return (data ?? []) as VideoRecord[];
  } else {
    const { data, error } = await sb
      .from('videos')
      .select('id, title, status, format')
      .eq('id', videoArg)
      .single();
    if (error) throw new Error(`Video ${videoArg} not found: ${error.message}`);
    return [data as VideoRecord];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}=== Caught on Camera — Emergency Takedown ===${RESET}`);
if (isDryRun) console.log(`${YELLOW}DRY-RUN MODE — no changes will be made${RESET}`);
console.log('');

let targetVideos: VideoRecord[];
try {
  targetVideos = await resolveTargetVideos();
} catch (err) {
  console.error(`${RED}${err instanceof Error ? err.message : String(err)}${RESET}`);
  process.exit(1);
}

if (targetVideos.length === 0) {
  console.log(`${YELLOW}No videos found matching the target criteria.${RESET}`);
  if (videoArg === 'all') {
    console.log(`(No videos with status 'published' or 'approved' in database)`);
  }
  process.exit(0);
}

console.log(`${BOLD}Target:${RESET} ${videoArg === 'all' ? `ALL published videos (${targetVideos.length})` : videoArg}`);
console.log('');

const allRemoved: string[] = [];
const allFailed: string[]  = [];

for (const video of targetVideos) {
  const fmt   = `[${(video.format ?? '?').replace('_', ' ').toUpperCase()}]`;
  const title = video.title ?? video.id;
  console.log(`${CYAN}${fmt}${RESET} ${BOLD}${title}${RESET}  ${DIM}(${video.id})${RESET}`);

  try {
    const { removed, failed } = await takedownVideo(video);
    allRemoved.push(...removed.map(p => `${video.id}:${p}`));
    allFailed.push(...failed.map(p => `${video.id}:${p}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${RED}Error: ${msg}${RESET}`);
    allFailed.push(`${video.id}:error`);
  }
  console.log('');
}

// ── Summary ───────────────────────────────────────────────────────────────────

if (!isDryRun) {
  const removedPlatforms = [...new Set(allRemoved.map(s => s.split(':')[1]))];
  const failedPlatforms  = [...new Set(allFailed.map(s => s.split(':')[1]))];

  console.log(`${BOLD}Takedown summary:${RESET}`);
  console.log(`  ${GREEN}Removed:${RESET} ${allRemoved.length} platform publishes  (${removedPlatforms.join(', ') || 'none'})`);
  if (allFailed.length > 0) {
    console.log(`  ${RED}Failed:${RESET}  ${allFailed.length} platform publishes  (${failedPlatforms.join(', ')}) — remove manually`);
  }

  // Telegram confirmation
  const videoCount = targetVideos.length;
  const tgMessage  = allFailed.length > 0
    ? `TAKEDOWN PARTIALLY COMPLETE: ${videoCount} video(s) — removed from [${removedPlatforms.join(', ')}] — FAILED on [${failedPlatforms.join(', ')}] — manual removal required`
    : `TAKEDOWN COMPLETE: ${videoCount} video(s) removed from all platforms [${removedPlatforms.join(', ')}]`;

  await sendTelegramAlert(tgMessage);
  console.log(`\nTelegram confirmation sent.`);
} else {
  console.log(`${YELLOW}DRY-RUN complete — no changes made.${RESET}`);
  console.log(`Run without --dry-run to perform actual takedown.`);
}

if (allFailed.length > 0) {
  console.log(`\n${RED}${BOLD}Some platform removals failed — manual intervention required.${RESET}\n`);
  process.exit(1);
}

console.log('');
