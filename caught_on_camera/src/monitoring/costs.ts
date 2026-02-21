/**
 * Cost monitoring — records per-video/scene spend and checks daily budget caps.
 *
 * All costs are persisted to the `cost_events` Supabase table and queried
 * for daily roll-ups. Budget state is checked before each generation cycle.
 */
import { dbInsert, dbSelectFiltered } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { env, BUDGET } from '../config.js';
import { sendBudgetAlert } from './telegram.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().split('T')[0]!;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Record the cost of a single generation event.
 * A generation event covers one Veo call + one Claude analysis + optional Cloudinary upload.
 *
 * @param params.videoId        Video record ID (optional — scenes may precede video creation).
 * @param params.sceneId        Scene record ID.
 * @param params.veoCost        USD cost of the Veo generation call.
 * @param params.claudeCost     USD cost of Claude API tokens consumed.
 * @param params.cloudinaryCost USD cost of Cloudinary storage/bandwidth (optional).
 * @param params.veoVariant     Veo prompt variant label (e.g. 'ring_cam_v1').
 */
export async function trackCost(params: {
  videoId?: string;
  sceneId?: string;
  veoCost: number;
  claudeCost: number;
  cloudinaryCost?: number;
  veoVariant: string;
}): Promise<void> {
  const totalCost = params.veoCost + params.claudeCost + (params.cloudinaryCost ?? 0);

  await dbInsert('cost_events', {
    video_id:        params.videoId ?? null,
    scene_id:        params.sceneId ?? null,
    veo_cost:        params.veoCost,
    claude_cost:     params.claudeCost,
    cloudinary_cost: params.cloudinaryCost ?? 0,
    total_cost:      totalCost,
    veo_variant:     params.veoVariant,
    recorded_date:   todayIso(),
  });

  logger.info('Costs: event recorded', {
    veo:       params.veoCost,
    claude:    params.claudeCost,
    cloudinary: params.cloudinaryCost ?? 0,
    total:     totalCost,
    variant:   params.veoVariant,
  });

  // Check if we should fire budget alerts
  const daily = await getDailySpend();
  if (daily >= BUDGET.hardCap) {
    logger.warn('Costs: hard cap reached', { daily, cap: BUDGET.hardCap });
    await sendBudgetAlert(daily, BUDGET.hardCap);
  } else if (daily >= BUDGET.warning) {
    await sendBudgetAlert(daily, BUDGET.hardCap);
  }
}

/**
 * Return total USD spend for today (midnight-to-now UTC).
 */
export async function getDailySpend(): Promise<number> {
  const today = todayIso();

  // TODO: replace with a Supabase RPC / SQL SUM once the db client supports aggregations
  const rows = await dbSelectFiltered('cost_events', (q) =>
    q.eq('recorded_date', today).select('total_cost'),
  );

  const total = rows.reduce((sum, row) => sum + (Number(row['total_cost']) || 0), 0);
  logger.debug('Costs: daily spend', { today, total });
  return total;
}

/**
 * Check whether the pipeline can generate another video today.
 *
 * Returns:
 *   canGenerate  — false if at or above hard cap
 *   spent        — total USD spent today
 *   remaining    — USD left before hard cap
 *   atWarning    — true if spend has passed the warning threshold
 */
export async function checkBudget(): Promise<{
  canGenerate: boolean;
  spent: number;
  remaining: number;
  atWarning: boolean;
}> {
  const spent = await getDailySpend();
  const remaining = Math.max(0, BUDGET.hardCap - spent);
  const canGenerate = spent < BUDGET.hardCap;
  const atWarning = spent >= BUDGET.warning;

  logger.info('Costs: budget check', { spent, remaining, canGenerate, atWarning });
  return { canGenerate, spent, remaining, atWarning };
}

/**
 * Return cost-efficiency metrics over the last `days` days.
 *
 * @param days  Number of days of history to include (e.g. 7 or 30).
 */
export async function getCostEfficiency(
  days: number,
): Promise<{ avgCostPerVideo: number; avgCostPerView: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();

  // Fetch cost events within the window
  const costRows = await dbSelectFiltered('cost_events', (q) =>
    q.gte('created_at', cutoffIso).select('total_cost, video_id'),
  );

  // Group costs by video_id to compute per-video total
  const costByVideo = new Map<string, number>();
  for (const row of costRows) {
    const vid = String(row['video_id'] ?? '_none');
    costByVideo.set(vid, (costByVideo.get(vid) ?? 0) + Number(row['total_cost'] || 0));
  }

  const videoCount = costByVideo.size;
  const totalCost = Array.from(costByVideo.values()).reduce((s, v) => s + v, 0);
  const avgCostPerVideo = videoCount > 0 ? totalCost / videoCount : 0;

  // TODO: fetch platform_views from analytics table and compute avgCostPerView
  // For now return 0 as a placeholder until the analytics module is wired up.
  const avgCostPerView = 0;

  logger.info('Costs: efficiency metrics', { days, videoCount, avgCostPerVideo });
  return { avgCostPerVideo, avgCostPerView };
}
