/**
 * Buffer monitor — tracks approved-but-unpublished video count.
 */
import { getBufferDepth } from '../db/videos.js';
import { logger } from '../utils/logger.js';
import { telegram } from './telegram.js';
import { env } from '../config.js';

const BUFFER_MAX = Number(env.BUFFER_MAX ?? 5);

export async function isBufferHealthy(): Promise<boolean> {
  const depth = await getBufferDepth();
  logger.info('Buffer check', { depth, threshold: BUFFER_MAX });
  return depth >= BUFFER_MAX;
}

export async function checkAndAlertBuffer(): Promise<void> {
  const depth = await getBufferDepth();
  if (depth <= 1) {
    await telegram.error(`Buffer critical: only ${depth} approved video(s) queued`);
  } else if (depth <= 2) {
    await telegram.alert(`Buffer low: ${depth} approved video(s) queued`);
  } else {
    logger.info(`Buffer healthy: ${depth} videos`);
  }
}
