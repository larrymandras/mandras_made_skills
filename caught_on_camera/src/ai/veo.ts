/**
 * Video generation — fal.ai Veo 3.1 text-to-video.
 * No character reference images, no image-to-video, no Replicate fallback.
 * This module is the sole entry-point for clip generation; never call fal.ai
 * directly from pipeline or gate modules.
 */
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { CamFormat } from '../config.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const FAL_VEO_ENDPOINT = 'https://queue.fal.run/fal-ai/veo3';

// Approximate per-second cost for Veo 3.1 at standard quality (update if pricing changes)
const VEO_COST_PER_SECOND = 0.30;

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface GeneratedClip {
  /** Publicly accessible URL of the generated video (fal.ai CDN) */
  videoUrl: string;
  /** Estimated USD cost of the generation call */
  cost: number;
  /** Actual duration of the returned clip in seconds */
  durationSeconds: number;
}

export interface ExtendedClip extends GeneratedClip {
  /** URL of the original clip that was extended */
  sourceVideoUrl: string;
}

// ── Format-specific prompt prefixes ──────────────────────────────────────────

const FORMAT_PROMPT_PREFIX: Record<CamFormat, string> = {
  ring_cam:  'Static wide-angle security camera footage. Fixed camera. Slight fisheye lens distortion. Timestamp overlay in corner. Low-light sensor grain.',
  body_cam:  'First-person body camera point-of-view footage. Hand-held camera shake. Heavy motion blur during movement. Breathing visible in subtle vertical sway.',
};

// ── Core generation ───────────────────────────────────────────────────────────

/**
 * Generate a new clip via fal.ai Veo 3.1 text-to-video.
 *
 * @param prompt          Scene description. Format-specific prefix is automatically prepended.
 * @param durationSeconds Requested clip length (typically 5–15 s).
 * @param format          'ring_cam' or 'body_cam' — controls cinematic prefix injected into prompt.
 */
export async function generateClip(
  prompt: string,
  durationSeconds: number,
  format: CamFormat,
): Promise<GeneratedClip> {
  logger.info('veo.generateClip', { format, durationSeconds });

  const fullPrompt = `${FORMAT_PROMPT_PREFIX[format]} ${prompt}`;

  return withRetry(async () => {
    // TODO: implement full fal.ai queue/poll cycle:
    //   1. POST to FAL_VEO_ENDPOINT with { prompt: fullPrompt, duration: durationSeconds }
    //      Authorization: Key ${env.FAL_KEY}
    //   2. Receive { request_id } from the queue response
    //   3. Poll GET https://queue.fal.run/fal-ai/veo3/requests/{request_id}/status
    //      until status === 'COMPLETED' (poll every 5 s, timeout after 10 min)
    //   4. Fetch result from GET https://queue.fal.run/fal-ai/veo3/requests/{request_id}
    //   5. Extract video URL from result.video.url
    //   6. Return GeneratedClip with estimated cost

    logger.debug('veo.generateClip: calling fal.ai', { endpoint: FAL_VEO_ENDPOINT });

    throw new Error('veo.generateClip not implemented — TODO: fal.ai queue/poll cycle');

    // Expected shape:
    // return {
    //   videoUrl:        result.video.url,
    //   cost:            durationSeconds * VEO_COST_PER_SECOND,
    //   durationSeconds: result.video.duration ?? durationSeconds,
    // };
  }, { maxAttempts: 3, baseDelayMs: 5_000, backoffFactor: 2 });
}

// ── Clip extension ────────────────────────────────────────────────────────────

/**
 * Extend an existing Veo clip by appending additional seconds.
 * Useful when a generated clip is slightly shorter than target duration.
 *
 * @param videoUrl          URL of the source clip (must be accessible by fal.ai).
 * @param additionalSeconds Number of seconds to append.
 */
export async function extendClip(
  videoUrl: string,
  additionalSeconds: number,
): Promise<ExtendedClip> {
  logger.info('veo.extendClip', { videoUrl, additionalSeconds });

  return withRetry(async () => {
    // TODO: implement fal.ai video extension:
    //   1. POST to fal.ai video-extend endpoint (confirm endpoint with fal.ai docs)
    //      Body: { video_url: videoUrl, duration: additionalSeconds }
    //      Authorization: Key ${env.FAL_KEY}
    //   2. Poll for completion (same pattern as generateClip)
    //   3. Return ExtendedClip

    throw new Error('veo.extendClip not implemented — TODO: fal.ai extension endpoint');

    // Expected shape:
    // return {
    //   videoUrl:        result.video.url,
    //   cost:            additionalSeconds * VEO_COST_PER_SECOND,
    //   durationSeconds: result.video.duration ?? additionalSeconds,
    //   sourceVideoUrl:  videoUrl,
    // };
  }, { maxAttempts: 3, baseDelayMs: 5_000, backoffFactor: 2 });
}

// ── Internal helpers (unexported) ─────────────────────────────────────────────

/** Poll a fal.ai queue request until it reaches COMPLETED or FAILED status. */
async function _pollFalQueue(
  _requestId: string,
  _timeoutMs = 600_000,
  _intervalMs = 5_000,
): Promise<unknown> {
  // TODO: implement polling loop with exponential back-off and timeout guard
  throw new Error('_pollFalQueue not implemented');
}
