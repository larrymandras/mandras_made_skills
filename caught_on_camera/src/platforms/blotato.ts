/**
 * Blotato multi-platform scheduling API client.
 *
 * Blotato acts as a unified distribution layer for YouTube, TikTok, and
 * Instagram. All posts are submitted via Blotato so we get a single audit
 * trail and avoid managing per-platform OAuth flows directly.
 *
 * Retry logic: 3 attempts with exponential backoff.
 * On permanent failure: adds the video to the manual_publish_queue table.
 */
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { dbInsert } from '../db/client.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BLOTATO_BASE = 'https://api.blotato.com/v1';

// Map our platform names to Blotato account IDs from env
const ACCOUNT_IDS: Record<string, string> = {
  youtube:   env.BLOTATO_YOUTUBE_ACCOUNT_ID,
  shorts:    env.BLOTATO_YOUTUBE_ACCOUNT_ID,   // Shorts use the same YouTube account
  tiktok:    env.BLOTATO_TIKTOK_ACCOUNT_ID,
  instagram: env.BLOTATO_INSTAGRAM_ACCOUNT_ID,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlatformMetadata {
  title: string;
  description: string;
  hashtags: string[];
  isAiGenerated: boolean;
  notForKids?: boolean;
}

export interface PostResult {
  postId: string;
  postSubmissionId: string;
}

// ── Internal HTTP helper ──────────────────────────────────────────────────────

async function blatoRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${BLOTATO_BASE}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.BLOTATO_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Blotato ${method} ${endpoint} failed: HTTP ${res.status} — ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Submit a video post to Blotato for the specified platform.
 *
 * @param params.videoUrl   Publicly accessible URL of the video (Cloudinary CDN).
 * @param params.platform   Target platform identifier.
 * @param params.metadata   Platform-compliant metadata.
 */
export async function post(params: {
  videoUrl: string;
  platform: string;
  metadata: PlatformMetadata;
}): Promise<PostResult> {
  logger.info('Blotato: submitting post', { platform: params.platform });

  const accountId = ACCOUNT_IDS[params.platform];
  if (!accountId) {
    throw new Error(`Blotato: no account ID configured for platform "${params.platform}"`);
  }

  // TODO: confirm exact Blotato API request shape from their documentation
  // Payload structure is illustrative and may need adjustment
  const result = await blatoRequest<{ post_id: string; submission_id: string }>(
    'POST',
    '/posts',
    {
      account_id:      accountId,
      platform:        params.platform,
      video_url:       params.videoUrl,
      title:           params.metadata.title,
      description:     params.metadata.description,
      hashtags:        params.metadata.hashtags,
      is_ai_generated: params.metadata.isAiGenerated,
      not_for_kids:    params.metadata.notForKids ?? true,
    },
  );

  logger.info('Blotato: post submitted', {
    platform:          params.platform,
    postId:            result.post_id,
    postSubmissionId:  result.submission_id,
  });

  return {
    postId:            result.post_id,
    postSubmissionId:  result.submission_id,
  };
}

/**
 * Poll the status of a Blotato post submission.
 *
 * @param postSubmissionId  The submission ID returned by post().
 */
export async function checkPostStatus(
  postSubmissionId: string,
): Promise<'pending' | 'published' | 'failed'> {
  logger.debug('Blotato: checking post status', { postSubmissionId });

  // TODO: confirm Blotato status endpoint path and response shape
  const result = await blatoRequest<{ status: string }>(
    'GET',
    `/submissions/${postSubmissionId}`,
  );

  const statusMap: Record<string, 'pending' | 'published' | 'failed'> = {
    pending:   'pending',
    processing:'pending',
    completed: 'published',
    published: 'published',
    failed:    'failed',
    error:     'failed',
  };

  return statusMap[result.status] ?? 'pending';
}

/**
 * Add a pinned comment to a published post.
 * Not all platforms support pinned comments — failures are logged but not thrown.
 *
 * @param postId    The platform post ID (not the Blotato submission ID).
 * @param platform  Platform identifier.
 * @param text      The comment text to pin.
 */
export async function addPinnedComment(
  postId: string,
  platform: string,
  text: string,
): Promise<void> {
  logger.info('Blotato: adding pinned comment', { postId, platform });

  const accountId = ACCOUNT_IDS[platform];
  if (!accountId) return; // platform not configured — skip silently

  // TODO: confirm Blotato pinned-comment endpoint from their documentation
  await blatoRequest('POST', `/posts/${postId}/pin-comment`, {
    account_id: accountId,
    platform,
    text,
  });

  logger.info('Blotato: pinned comment added', { postId, platform });
}

/**
 * Attempt to publish a video with 3 retries.
 * On permanent failure, adds the video to the manual_publish_queue table
 * and returns a placeholder postId so the caller can continue.
 *
 * @param video     VideoRecord-like object (must have id, title, caption, cloudinary URL).
 * @param platform  Target platform identifier.
 * @returns         The platform postId on success.
 */
export async function publishWithFallback(
  video: { id: string; title: string; caption: string; master_16x9_url?: string; vertical_9x16_url?: string | null },
  platform: string,
): Promise<string> {
  const videoUrl = video.vertical_9x16_url ?? video.master_16x9_url ?? '';

  try {
    const result = await withRetry(
      () =>
        post({
          videoUrl,
          platform,
          metadata: {
            title:          video.title,
            description:    video.caption,
            hashtags:       [],
            isAiGenerated:  true,
            notForKids:     true,
          },
        }),
      { maxAttempts: 3, baseDelayMs: 5_000, backoffFactor: 2 },
    );

    return result.postId;
  } catch (err) {
    logger.error('Blotato: all retries exhausted — adding to manual queue', {
      videoId: video.id,
      platform,
      error: String(err),
    });

    // Add to manual_publish_queue so a human can retry
    await dbInsert('manual_publish_queue', {
      video_id:   video.id,
      platform,
      video_url:  videoUrl,
      title:      video.title,
      caption:    video.caption,
      error_msg:  String(err),
      created_at: new Date().toISOString(),
    }).catch((dbErr) => {
      logger.error('Blotato: failed to write to manual queue', { dbErr });
    });

    // Return a sentinel — caller should not treat this as a successful publish
    return `MANUAL_QUEUE:${video.id}:${platform}`;
  }
}
