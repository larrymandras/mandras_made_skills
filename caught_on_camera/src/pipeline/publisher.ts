/**
 * Distribution publisher — posts approved videos to all enabled platforms
 * via Blotato, with per-platform rate limiting and optimal time-slot selection.
 *
 * Always sets isAiGenerated=true and includes the AI disclosure in captions.
 * Partial platform failures are logged but do not abort other platforms.
 */
import { logger } from '../utils/logger.js';
import {
  post,
  addPinnedComment,
  publishWithFallback,
} from '../platforms/blotato.js';
import { PLATFORM_LIMITS } from '../config.js';
import { dbSelectFiltered, dbInsert } from '../db/client.js';
import type { VideoRecord } from '../db/videos.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlatformMetadata {
  title: string;
  description: string;
  hashtags: string[];
  isAiGenerated: true;
  disclosureCaption: string;
  pinnedComment: string;
  notForKids: true;
}

// ── Compliance helpers ────────────────────────────────────────────────────────

const AI_DISCLOSURE_SUFFIX =
  '\n\n⚡ AI Generated | This content is synthetically produced.';

const PINNED_COMMENT_TEXT =
  'This video is AI-generated content created for entertainment. ' +
  'All footage is synthetic and does not depict real events or individuals.';

/**
 * Build platform-compliant metadata for a video.
 * Always injects AI disclosure into caption and marks as AI-generated.
 */
export function generateCompliantMetadata(
  video: VideoRecord,
  platform: string,
): PlatformMetadata {
  // Trim caption to platform-specific limits
  const captionLimits: Record<string, number> = {
    tiktok:    2200,
    instagram: 2200,
    youtube:   5000,
    shorts:    5000,
  };
  const limit = captionLimits[platform] ?? 2200;
  const baseCaption = video.caption.slice(0, limit - AI_DISCLOSURE_SUFFIX.length);
  const disclosureCaption = baseCaption + AI_DISCLOSURE_SUFFIX;

  // Platform-specific title formatting
  let title = video.title;
  if (platform === 'youtube' || platform === 'shorts') {
    // YouTube titles: max 100 chars
    title = title.slice(0, 100);
  }

  return {
    title,
    description:       disclosureCaption,
    hashtags:          video.hashtags,
    isAiGenerated:     true,
    disclosureCaption,
    pinnedComment:     PINNED_COMMENT_TEXT,
    notForKids:        true,
  };
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

/**
 * Check whether we are within the daily posting limit for a given platform.
 * Queries the platform_publishes table for today's count.
 */
export async function canPublishToday(platform: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0]!;

  // TODO: replace with a proper SQL COUNT once the db client supports aggregations
  const rows = await dbSelectFiltered('platform_publishes', (q) =>
    q
      .eq('platform', platform)
      .eq('publish_date', today)
      .eq('status', 'published')
      .select('id'),
  );

  const limit = PLATFORM_LIMITS[platform as keyof typeof PLATFORM_LIMITS]?.maxPerDay ?? 2;
  const todayCount = rows.length;
  const canPublish = todayCount < limit;

  logger.info('Publisher: daily limit check', { platform, todayCount, limit, canPublish });
  return canPublish;
}

// ── Optimal time-slot selection ───────────────────────────────────────────────

/** Platform-specific optimal posting times (UTC hours) */
const OPTIMAL_HOURS: Record<string, number[]> = {
  tiktok:    [12, 15, 19, 21],
  instagram: [11, 14, 17, 20],
  youtube:   [14, 16, 19],
  shorts:    [14, 16, 19],
};

function nextOptimalSlot(platform: string): Date {
  const now = new Date();
  const hours = OPTIMAL_HOURS[platform] ?? [14, 19];
  const currentHour = now.getUTCHours();

  // Find the next optimal hour today or tomorrow
  const nextHour = hours.find((h) => h > currentHour);
  const slot = new Date(now);

  if (nextHour !== undefined) {
    slot.setUTCHours(nextHour, 0, 0, 0);
  } else {
    // Roll over to tomorrow's first slot
    slot.setUTCDate(slot.getUTCDate() + 1);
    slot.setUTCHours(hours[0] ?? 14, 0, 0, 0);
  }

  return slot;
}

// ── Core publish functions ─────────────────────────────────────────────────────

/**
 * Publish a video to one or more platforms via Blotato.
 *
 * @param video      Approved video record from the DB.
 * @param platforms  Array of platform identifiers to post to.
 * @returns          Map of platform → postId for successful posts.
 */
export async function publishVideo(
  video: VideoRecord,
  platforms: string[],
): Promise<Record<string, string>> {
  logger.info('Publisher: publishing video', { videoId: video.id, platforms });

  const postIds: Record<string, string> = {};

  for (const platform of platforms) {
    // Rate-limit check
    const allowed = await canPublishToday(platform);
    if (!allowed) {
      logger.warn('Publisher: daily limit reached for platform — skipping', {
        videoId: video.id,
        platform,
      });
      continue;
    }

    const metadata = generateCompliantMetadata(video, platform);
    const videoUrl = video.vertical_9x16_url ?? video.master_16x9_url;

    try {
      const postId = await publishWithFallback(
        { ...video, title: metadata.title, caption: metadata.disclosureCaption },
        platform,
      );
      postIds[platform] = postId;

      // Add pinned comment on platforms that support it
      try {
        await addPinnedComment(postId, platform, PINNED_COMMENT_TEXT);
      } catch (commentErr) {
        logger.warn('Publisher: pinned comment failed (non-fatal)', {
          platform,
          postId,
          error: String(commentErr),
        });
      }

      // Record successful publish
      await dbInsert('platform_publishes', {
        video_id:     video.id,
        platform,
        post_id:      postId,
        video_url:    videoUrl,
        status:       'published',
        publish_date: new Date().toISOString().split('T')[0],
        published_at: new Date().toISOString(),
      });

      logger.info('Publisher: published to platform', { videoId: video.id, platform, postId });
    } catch (err) {
      logger.error('Publisher: platform publish failed (non-fatal)', {
        videoId: video.id,
        platform,
        error: String(err),
      });
      // Record failure
      await dbInsert('platform_publishes', {
        video_id:     video.id,
        platform,
        status:       'failed',
        error_msg:    String(err),
        publish_date: new Date().toISOString().split('T')[0],
      }).catch(() => {});
    }
  }

  logger.info('Publisher: publish run complete', { videoId: video.id, postIds });
  return postIds;
}

/**
 * Schedule a video for publication at the next optimal time slot per platform.
 * Writes a scheduled_posts record for each platform; a cron job will pick them up.
 */
export async function schedulePublish(video: VideoRecord): Promise<void> {
  logger.info('Publisher: scheduling video', { videoId: video.id });

  const platforms = ['youtube', 'shorts', 'tiktok', 'instagram'] as const;

  for (const platform of platforms) {
    const allowed = await canPublishToday(platform);
    if (!allowed) {
      logger.warn('Publisher: daily limit reached — scheduling tomorrow', {
        videoId: video.id,
        platform,
      });
    }

    const scheduledAt = nextOptimalSlot(platform);
    const metadata = generateCompliantMetadata(video, platform);

    await dbInsert('scheduled_posts', {
      video_id:       video.id,
      platform,
      scheduled_at:   scheduledAt.toISOString(),
      title:          metadata.title,
      description:    metadata.disclosureCaption,
      hashtags:       video.hashtags,
      is_ai_generated: true,
      status:         'pending',
    });

    logger.info('Publisher: post scheduled', {
      videoId: video.id,
      platform,
      scheduledAt: scheduledAt.toISOString(),
    });
  }
}
