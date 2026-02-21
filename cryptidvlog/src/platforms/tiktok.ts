/**
 * TikTok publisher — uses Content Posting API with AIGC label.
 */
import { logger } from '../utils/logger.js';

export async function uploadToTikTok(params: {
  videoPath: string;
  title: string;
  hashtags: string[];
}): Promise<{ id: string; url: string }> {
  logger.info('TikTok: uploading', { title: params.title });
  // TODO: TikTok Content Posting API v2 — init upload, chunk upload, publish
  //   Set: brand_content_toggle = true (AIGC disclosure)
  throw new Error('TikTok upload not implemented');
}

export async function deleteFromTikTok(platformVideoId: string): Promise<void> {
  logger.info('TikTok: deleting', { platformVideoId });
  // TODO: POST https://open.tiktokapis.com/v2/video/delete/
  throw new Error('TikTok delete not implemented');
}
