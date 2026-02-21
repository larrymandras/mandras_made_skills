/**
 * Buffer monitor — tracks the depth of approved-but-unpublished videos and
 * decides whether the pipeline should generate more content.
 *
 * Target buffer: 3-day supply at 3.5 videos/day = 10.5 videos minimum.
 * Critical threshold: < 1 day (< 3–4 videos) → generate_extra + telegram alert.
 * Healthy threshold: >= 3 days → pause generation.
 */
import { getApprovedUnpublished } from '../db/videos.js';
import { logger } from '../utils/logger.js';
import { sendBufferAlert } from './telegram.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const VIDEOS_PER_DAY = 3.5;
const BUFFER_TARGET_DAYS = 3;
const BUFFER_CRITICAL_DAYS = 1;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Check the current buffer depth and determine the pipeline action.
 *
 * Returns:
 *   bufferDays   — estimated days of content remaining at current posting rate
 *   videoCount   — raw count of approved + unpublished videos
 *   action       — 'generate_extra' | 'normal' | 'pause'
 */
export async function checkBuffer(): Promise<{
  bufferDays: number;
  videoCount: number;
  action: 'generate_extra' | 'normal' | 'pause';
}> {
  const videos = await getApprovedUnpublished();
  const videoCount = videos.length;
  const bufferDays = videoCount / VIDEOS_PER_DAY;

  logger.info('Buffer: current status', {
    videoCount,
    bufferDays: bufferDays.toFixed(2),
    targetDays: BUFFER_TARGET_DAYS,
  });

  if (bufferDays < BUFFER_CRITICAL_DAYS) {
    logger.warn('Buffer: CRITICAL — below 1-day threshold', { bufferDays });
    await sendBufferAlert(bufferDays);
    return { bufferDays, videoCount, action: 'generate_extra' };
  }

  if (bufferDays >= BUFFER_TARGET_DAYS) {
    logger.info('Buffer: healthy — skipping generation cycle', { bufferDays });
    return { bufferDays, videoCount, action: 'pause' };
  }

  // Between critical and target: generate at normal rate
  logger.info('Buffer: normal — generating one video', { bufferDays });
  return { bufferDays, videoCount, action: 'normal' };
}

/**
 * Return buffer status without side effects (no Telegram alerts).
 * Useful for the /buffer Telegram command and the /status dashboard.
 */
export async function getBufferStatus(): Promise<{
  approvedCount: number;
  bufferDays: number;
}> {
  const videos = await getApprovedUnpublished();
  const approvedCount = videos.length;
  const bufferDays = approvedCount / VIDEOS_PER_DAY;

  logger.info('Buffer: status queried', { approvedCount, bufferDays });
  return { approvedCount, bufferDays };
}
