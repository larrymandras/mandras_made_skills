/**
 * TikTok-specific upload helper.
 *
 * Always sets isAiGenerated=true (brand_content_toggle = AIGC disclosure)
 * per TikTok Content Posting API v2 requirements.
 *
 * Upload is delegated to Blotato for unified scheduling.
 */
import { logger } from '../utils/logger.js';
import { post } from './blotato.js';

// ── Shared constants ──────────────────────────────────────────────────────────

const AI_DISCLOSURE_SUFFIX =
  ' | AI Generated Content #AIGenerated';

const MAX_CAPTION_LENGTH = 2200;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Upload a video to TikTok via Blotato.
 *
 * TikTok-specific notes:
 * - Vertical 9:16 format required for best algorithmic performance.
 * - brand_content_toggle should be set to true (AIGC label) — Blotato handles this.
 * - Caption max 2200 characters.
 *
 * @param videoUrl   Publicly accessible URL of the vertical video.
 * @param metadata   Title/caption and hashtag metadata.
 */
export async function upload(
  videoUrl: string,
  metadata: {
    title: string;
    hashtags: string[];
    caption?: string;
  },
): Promise<{ postId: string; postSubmissionId: string }> {
  logger.info('TikTok: uploading video', { title: metadata.title });

  // TikTok uses a combined caption field (no separate description)
  const baseCaption = (metadata.caption ?? metadata.title).slice(
    0,
    MAX_CAPTION_LENGTH - AI_DISCLOSURE_SUFFIX.length,
  );
  const caption = baseCaption + AI_DISCLOSURE_SUFFIX;

  const result = await post({
    videoUrl,
    platform: 'tiktok',
    metadata: {
      title:         caption,          // TikTok uses title as caption
      description:   caption,
      hashtags:      metadata.hashtags,
      isAiGenerated: true,             // maps to brand_content_toggle=true via Blotato
      notForKids:    true,
    },
  });

  // TODO: if Blotato does not support the TikTok AIGC label natively,
  // fall back to TikTok Content Posting API v2 directly:
  //   POST https://open.tiktokapis.com/v2/post/publish/video/init/
  //   Set: brand_content_toggle = true, brand_organic_toggle = true (AI-generated disclosure)
  //   POST https://open.tiktokapis.com/v2/post/publish/video/complete/
  // Reference: https://developers.tiktok.com/doc/content-posting-api-get-started-upload-video

  logger.info('TikTok: video submitted', { postId: result.postId });
  return result;
}
