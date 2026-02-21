/**
 * Instagram Reels publisher — uses Instagram Graph API.
 */
import { logger } from '../utils/logger.js';

export async function uploadToInstagram(params: {
  videoPath: string;
  caption: string;
}): Promise<{ id: string; url: string }> {
  logger.info('Instagram: uploading reel');
  // TODO: Instagram Graph API flow:
  //   1. POST /me/media — create container (video_url, media_type=REELS, caption)
  //   2. Poll container status until FINISHED
  //   3. POST /me/media_publish — publish container
  throw new Error('Instagram upload not implemented');
}

export async function deleteFromInstagram(platformVideoId: string): Promise<void> {
  logger.info('Instagram: deleting', { platformVideoId });
  // TODO: DELETE /{platformVideoId}
  throw new Error('Instagram delete not implemented');
}
