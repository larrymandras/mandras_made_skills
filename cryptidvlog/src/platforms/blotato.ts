/**
 * Blotato multi-platform scheduler (optional alternative to direct platform APIs).
 */
import { logger } from '../utils/logger.js';
import { env } from '../config.js';

export async function scheduleViaBlotato(params: {
  videoPath: string;
  platforms: Array<'youtube' | 'tiktok' | 'instagram'>;
  scheduledAt: Date;
  title: string;
  description: string;
}): Promise<{ jobId: string }> {
  logger.info('Blotato: scheduling post', { platforms: params.platforms });
  // TODO: Blotato API — upload video file, create scheduled post for each platform
  throw new Error('Blotato scheduler not implemented');
}
