/**
 * YouTube Shorts publisher.
 * Always sets selfDeclaredMadeForKids: false and synthetic media label.
 */
import { logger } from '../utils/logger.js';

export async function uploadToYouTube(params: {
  videoPath: string;
  title: string;
  description: string;
  hashtags: string[];
}): Promise<{ id: string; url: string }> {
  logger.info('YouTube: uploading', { title: params.title });
  // TODO: YouTube Data API v3 — resumable upload, set:
  //   snippet.categoryId = '22' (People & Blogs)
  //   status.selfDeclaredMadeForKids = false
  //   status.madeForKids = false
  //   Add synthetic media disclosure to description
  throw new Error('YouTube upload not implemented');
}

export async function deleteFromYouTube(platformVideoId: string): Promise<void> {
  logger.info('YouTube: deleting', { platformVideoId });
  // TODO: DELETE https://www.googleapis.com/youtube/v3/videos?id=platformVideoId
  throw new Error('YouTube delete not implemented');
}
