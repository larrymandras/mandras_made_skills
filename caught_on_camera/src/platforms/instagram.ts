/**
 * Instagram Reels-specific upload helper.
 *
 * Posts via Blotato with the AI-generated label flag set.
 * Instagram Graph API requires a two-step container + publish flow;
 * Blotato abstracts this behind a single API call.
 *
 * If Blotato does not support the AI-generated label, a direct Graph API
 * fallback is described in the TODO comments below.
 */
import { logger } from '../utils/logger.js';
import { post } from './blotato.js';

// ── Shared constants ──────────────────────────────────────────────────────────

const AI_DISCLOSURE_SUFFIX =
  '\n\n⚡ AI Generated Content | Synthetic media for entertainment.';

const MAX_CAPTION_LENGTH = 2200;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Upload a video as an Instagram Reel via Blotato.
 *
 * Instagram-specific notes:
 * - Vertical 9:16 (1080×1920) is required for Reels.
 * - The AI-generated label must be set per Meta's synthetic media policy.
 * - Blotato handles the container-creation → polling → publish flow.
 *
 * @param videoUrl   Publicly accessible URL of the vertical video.
 * @param metadata   Caption and hashtag metadata.
 */
export async function uploadReel(
  videoUrl: string,
  metadata: {
    caption: string;
    hashtags: string[];
  },
): Promise<{ postId: string; postSubmissionId: string }> {
  logger.info('Instagram: uploading Reel');

  const baseCaption = metadata.caption.slice(
    0,
    MAX_CAPTION_LENGTH - AI_DISCLOSURE_SUFFIX.length,
  );
  const caption = baseCaption + AI_DISCLOSURE_SUFFIX;

  const result = await post({
    videoUrl,
    platform: 'instagram',
    metadata: {
      title:         caption,    // Instagram uses caption only
      description:   caption,
      hashtags:      metadata.hashtags,
      isAiGenerated: true,       // maps to Meta AI-generated content label via Blotato
      notForKids:    true,
    },
  });

  // TODO: if Blotato does not support the Meta AI-generated label natively,
  // fall back to Instagram Graph API directly:
  //   Step 1: POST /{ig-user-id}/media
  //     Fields: video_url, media_type=REELS, caption, is_shared_to_feed=true
  //     Include ai_labels=AI_GENERATED (once Meta exposes this field publicly)
  //   Step 2: Poll GET /{creation-id}?fields=status_code until FINISHED
  //   Step 3: POST /{ig-user-id}/media_publish
  //     Fields: creation_id
  // Reference: https://developers.facebook.com/docs/instagram-api/guides/reels-publishing

  logger.info('Instagram: Reel submitted', { postId: result.postId });
  return result;
}
