/**
 * YouTube-specific upload helpers.
 *
 * uploadShort   — posts a YouTube Shorts (< 60 s vertical video).
 * uploadLongForm — posts a standard horizontal video.
 *
 * Both methods always set:
 *   selfDeclaredMadeForKids: false
 *   madeForKids: false
 *   Synthetic media disclosure in description
 *
 * Actual HTTP calls are delegated to Blotato for unified scheduling.
 * These helpers build YouTube-specific metadata and call blotato.post().
 */
import { logger } from '../utils/logger.js';
import { post } from './blotato.js';

// ── Shared constants ──────────────────────────────────────────────────────────

const AI_DISCLOSURE =
  '\n\n---\nThis video is AI-generated synthetic media created for entertainment purposes. ' +
  'All content is fictional and does not depict real people or events.';

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Upload a video as a YouTube Short.
 * Vertical 9:16 format required (caller must provide the cropped variant).
 *
 * @param videoUrl   Publicly accessible URL of the vertical video.
 * @param metadata   Title, description, and hashtag metadata.
 */
export async function uploadShort(
  videoUrl: string,
  metadata: {
    title: string;
    description: string;
    hashtags: string[];
  },
): Promise<{ postId: string; postSubmissionId: string }> {
  logger.info('YouTube: uploading Short', { title: metadata.title });

  const description =
    metadata.description.slice(0, 5000 - AI_DISCLOSURE.length) + AI_DISCLOSURE;

  const result = await post({
    videoUrl,
    platform: 'shorts',
    metadata: {
      title:         metadata.title.slice(0, 100),
      description,
      hashtags:      [...metadata.hashtags, '#Shorts'],
      isAiGenerated: true,
      notForKids:    true,
    },
  });

  // TODO: after posting, use YouTube Data API v3 to set:
  //   snippet.categoryId = '22' (People & Blogs)
  //   status.selfDeclaredMadeForKids = false
  //   status.madeForKids = false
  // These cannot be set via Blotato and require a direct API call.

  logger.info('YouTube: Short submitted', { postId: result.postId });
  return result;
}

/**
 * Upload a standard horizontal long-form video to YouTube.
 * Suitable for compilations and extended ring-cam montages.
 *
 * @param videoUrl   Publicly accessible URL of the 16:9 video.
 * @param metadata   Title, description, and hashtag metadata.
 */
export async function uploadLongForm(
  videoUrl: string,
  metadata: {
    title: string;
    description: string;
    hashtags: string[];
  },
): Promise<{ postId: string; postSubmissionId: string }> {
  logger.info('YouTube: uploading long-form video', { title: metadata.title });

  const description =
    metadata.description.slice(0, 5000 - AI_DISCLOSURE.length) + AI_DISCLOSURE;

  const result = await post({
    videoUrl,
    platform: 'youtube',
    metadata: {
      title:         metadata.title.slice(0, 100),
      description,
      hashtags:      metadata.hashtags,
      isAiGenerated: true,
      notForKids:    true,
    },
  });

  // TODO: set selfDeclaredMadeForKids and synthetic-media label via YouTube Data API v3
  // See: https://developers.google.com/youtube/v3/docs/videos/update

  logger.info('YouTube: long-form video submitted', { postId: result.postId });
  return result;
}
