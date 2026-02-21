/**
 * Main pipeline orchestrator for Caught on Camera.
 *
 * Coordinates budget checks, buffer checks, format selection, idea picking,
 * video production, DB persistence, and Telegram review notifications.
 */
import { logger } from '../utils/logger.js';
import { checkBudget } from '../monitoring/costs.js';
import { checkBuffer } from '../monitoring/buffer.js';
import { sendReviewRequest, sendAlert } from '../monitoring/telegram.js';
import { getTopRingCamIdea, getTopBodyCamIdea, markIdeaInProduction, markIdeaProduced } from '../db/ideas.js';
import { insertVideo } from '../db/videos.js';
import { produceVideo } from './producer.js';
import { FORMAT_SCHEDULE, type CamFormat } from '../config.js';
import { runRingCamIdeator } from './ideator-ring.js';
import { runBodyCamIdeator } from './ideator-body.js';

// ── Format selection ──────────────────────────────────────────────────────────

/**
 * Return today's format based on the day-of-week schedule configured in config.ts.
 * Falls back to 'ring_cam' if the schedule entry is 'operator_choice'.
 */
export function getFormatForToday(): CamFormat {
  const dow = String(new Date().getDay()); // 0=Sunday … 6=Saturday
  const entry = FORMAT_SCHEDULE[dow];

  if (!entry || entry.format === 'operator_choice') {
    // Default to ring_cam on unscheduled days
    logger.info('Pipeline: operator_choice day — defaulting to ring_cam');
    return 'ring_cam';
  }

  logger.info('Pipeline: format for today', { dow, format: entry.format });
  return entry.format as CamFormat;
}

// ── Main daily pipeline ────────────────────────────────────────────────────────

/**
 * Run one full production cycle:
 * 1. Budget gate — abort if at hard cap.
 * 2. Buffer gate — skip if buffer is >= 3 days.
 * 3. Select format for today.
 * 4. Pick top-scoring pending idea.
 * 5. Produce video (Veo → degradation → gates → overlay → Cloudinary).
 * 6. Insert video record and send Telegram review request.
 */
export async function runDailyPipeline(): Promise<void> {
  logger.info('Pipeline: starting daily run');

  // ── Step 1: Budget check ─────────────────────────────────────────────────
  const budget = await checkBudget();
  if (!budget.canGenerate) {
    logger.warn('Pipeline: hard budget cap reached — aborting', { spent: budget.spent });
    await sendAlert(
      `Daily hard cap reached ($${budget.spent.toFixed(2)}). No more videos will be generated today.`,
      'warning',
    );
    return;
  }

  if (budget.atWarning) {
    await sendAlert(
      `Budget warning: $${budget.spent.toFixed(2)} spent of $${(budget.spent + budget.remaining).toFixed(2)} cap.`,
      'warning',
    );
  }

  // ── Step 2: Buffer check ─────────────────────────────────────────────────
  const buffer = await checkBuffer();
  if (buffer.action === 'pause') {
    logger.info('Pipeline: buffer healthy — skipping generation', {
      bufferDays: buffer.bufferDays,
    });
    return;
  }

  // ── Step 3: Format selection ─────────────────────────────────────────────
  const format = getFormatForToday();
  logger.info('Pipeline: producing video', { format });

  // ── Step 4: Pick idea ────────────────────────────────────────────────────
  const idea =
    format === 'ring_cam'
      ? await getTopRingCamIdea()
      : await getTopBodyCamIdea();

  if (!idea) {
    logger.warn('Pipeline: no pending ideas available — running ideator');
    // Auto-run the appropriate ideator then exit (next cron tick will produce)
    if (format === 'ring_cam') {
      await runRingCamIdeator();
    } else {
      await runBodyCamIdeator();
    }
    return;
  }

  logger.info('Pipeline: selected idea', { ideaId: idea.id, title: idea.title });

  // Mark idea as in-production to prevent concurrent picks
  await markIdeaInProduction(idea.id, format);

  // ── Step 5: Produce video ────────────────────────────────────────────────
  let scene;
  try {
    scene = await produceVideo(idea, format);
  } catch (err) {
    logger.error('Pipeline: video production failed', { ideaId: idea.id, err });
    await sendAlert(
      `Video production failed for idea "${idea.title}": ${err instanceof Error ? err.message : String(err)}`,
      'critical',
    );
    throw err;
  }

  // ── Step 6: Persist video record ─────────────────────────────────────────
  const camSubType =
    format === 'body_cam'
      ? (idea as import('../db/ideas.js').BodyCamIdea).cam_sub_type
      : null;

  const videoRecord = await insertVideo({
    idea_id:              idea.id,
    idea_source:          format,
    compilation_id:       null,
    format,
    cam_sub_type:         camSubType,
    master_16x9_url:      scene.videoPath, // TODO: replace with Cloudinary URL once upload is wired
    vertical_9x16_url:    scene.cropSafe ? scene.videoPath : null,
    cloudinary_public_id: `caught_on_camera/${format}_${idea.id}`,
    title:                idea.title,
    caption:              idea.caption,
    hashtags:             idea.hashtags,
    reject_reason:        null,
    youtube_post_id:      null,
    shorts_post_id:       null,
    tiktok_post_id:       null,
    instagram_post_id:    null,
    crop_safe:            scene.cropSafe,
    gate_results:         {},
  });

  // Mark idea as produced
  await markIdeaProduced(idea.id, format);

  // ── Step 7: Telegram review request ──────────────────────────────────────
  await sendReviewRequest({
    id:            videoRecord.id,
    format,
    title:         idea.title,
    cloudinaryUrl: videoRecord.master_16x9_url,
    concept:       idea.scenario.slice(0, 200),
    cost:          scene.cost,
  });

  logger.info('Pipeline: daily run complete — awaiting operator review', {
    videoId: videoRecord.id,
    format,
    cost: scene.cost,
  });
}

// ── Ideator run ───────────────────────────────────────────────────────────────

/**
 * Run both ideators to top up the idea queues.
 * Called on a separate cron schedule (e.g. once daily at 6am).
 */
export async function runIdeators(): Promise<void> {
  logger.info('Pipeline: running ideators');
  await Promise.all([runRingCamIdeator(), runBodyCamIdeator()]);
  logger.info('Pipeline: ideators complete');
}

// ── Analytics stub ────────────────────────────────────────────────────────────

/**
 * Run analytics pass — suppression checks, cost efficiency, buffer health.
 * TODO: implement full analytics module and wire to cron.
 */
export async function runAnalytics(): Promise<void> {
  logger.info('Pipeline: running analytics');
  // TODO: checkAllPlatforms() → getPostingAdjustments() → log results
  // TODO: getCostEfficiency(7) → log results
  // TODO: getBufferStatus() → log results
  logger.warn('Pipeline: runAnalytics not fully implemented');
}
