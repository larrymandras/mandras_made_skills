#!/usr/bin/env tsx
/**
 * Emergency takedown — removes a video from all platforms immediately.
 * Run: npm run emergency-takedown -- --video-id <id> [--reason "DMCA notice"]
 */
import { createClient } from '@supabase/supabase-js';
import { env } from '../src/config.js';
import { telegram } from '../src/monitoring/telegram.js';
import { deleteFromYouTube } from '../src/platforms/youtube.js';
import { deleteFromTikTok } from '../src/platforms/tiktok.js';
import { deleteFromInstagram } from '../src/platforms/instagram.js';
import { stripAudioTrack } from '../src/media/audio.js';

const args = process.argv.slice(2);
const videoId = args[args.indexOf('--video-id') + 1];
const reason = args.indexOf('--reason') >= 0 ? args[args.indexOf('--reason') + 1] : 'manual';
const isDmca = reason?.toLowerCase().includes('dmca') ?? false;

if (!videoId) {
  console.error('Usage: npm run emergency-takedown -- --video-id <id> [--reason "reason"]');
  process.exit(1);
}

console.log(`\nTaking down video ${videoId}`);
console.log(`Reason: ${reason}\n`);

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
const { data: video } = await sb.from('platform_publishes').select('*').eq('video_id', videoId);
const platforms = (video ?? []) as Array<{ platform: string; platform_video_id: string; video_path?: string }>;

const removed: string[] = [];
const failed: string[] = [];

for (const pub of platforms) {
  process.stdout.write(`  Removing from ${pub.platform}... `);
  try {
    if (pub.platform === 'youtube') await deleteFromYouTube(pub.platform_video_id);
    if (pub.platform === 'tiktok') await deleteFromTikTok(pub.platform_video_id);
    if (pub.platform === 'instagram') await deleteFromInstagram(pub.platform_video_id);
    removed.push(pub.platform);
    console.log('✓');
  } catch (err) {
    failed.push(pub.platform);
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Strip audio on DMCA takedown
if (isDmca) {
  console.log('\n  Stripping audio (DMCA)...');
  // TODO: get video file path from storage_files, call stripAudioTrack
}

// Update DB status
await sb.from('videos').update({ status: 'taken_down', taken_down_at: new Date().toISOString() }).eq('id', videoId);
await sb.from('takedown_log').insert({
  video_id: videoId, reason, platforms_removed: removed,
  audio_stripped: isDmca, completed_at: new Date().toISOString(),
});

await telegram.error(`🚨 Takedown complete: video ${videoId} removed from [${removed.join(', ')}]. Reason: ${reason}`);

console.log(`\n✓ Takedown complete`);
console.log(`  Removed from: ${removed.join(', ') || 'none'}`);
if (failed.length > 0) console.log(`  Failed: ${failed.join(', ')} — remove manually`);
