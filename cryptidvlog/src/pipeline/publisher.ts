/**
 * Publisher — uploads approved video to all enabled platforms.
 * Always sets synthetic media label and not-for-kids flag.
 * Partial failure (some platforms succeed) is logged but not fatal.
 */
import { logger } from '../utils/logger.js';
import { uploadToYouTube } from '../platforms/youtube.js';
import { uploadToTikTok } from '../platforms/tiktok.js';
import { uploadToInstagram } from '../platforms/instagram.js';
import { dbInsert } from '../db/client.js';

export interface PublishResult {
  youtube?: { id: string; url: string };
  tiktok?: { id: string; url: string };
  instagram?: { id: string; url: string };
  failures: string[];
}

export async function publishVideo(
  videoId: string,
  videoPath: string,
  metadata: { title: string; description: string; hashtags: string[] },
): Promise<PublishResult> {
  logger.info('Publisher: publishing video', { videoId });
  const result: PublishResult = { failures: [] };

  // TODO: attempt each platform, catch errors per-platform (don't abort others on failure),
  //       write platform_publishes record for each attempt,
  //       update video status to 'published' if at least one platform succeeded
  throw new Error('Publisher not implemented');
}
