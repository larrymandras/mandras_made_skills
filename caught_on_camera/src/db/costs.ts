/**
 * Cost tracking DB operations.
 *
 * Records per-video / per-scene costs and provides budget-gate helpers.
 * The daily_spend table is updated automatically via a Postgres trigger
 * (see migration 003), but recordCost() also maintains an in-process
 * cache so callers do not need a round-trip to check the running total.
 */
import { dbInsert, dbSelect, dbSelectFiltered } from './client.js';
import { logger } from '../utils/logger.js';
import { env } from '../config.js';
import { telegram } from '../monitoring/telegram.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VeoVariant = 'text-to-video' | 'extend';

export interface CostRecord {
  id: string;
  video_id: string | null;
  scene_id: string | null;
  veo_cost: number;
  claude_cost: number;
  cloudinary_cost: number;
  total_cost: number;
  veo_variant: VeoVariant | null;
  notes: string | null;
  created_at: string;
}

export interface DailySpendRecord {
  id: string;
  date: string;
  veo_total: number;
  claude_total: number;
  cloudinary_total: number;
  grand_total: number;
  video_count: number;
  updated_at: string;
}

export interface RecordCostParams {
  videoId?: string;
  sceneId?: string;
  veoCost?: number;
  claudeCost?: number;
  cloudinaryCost?: number;
  veoVariant?: VeoVariant;
  notes?: string;
}

export interface BudgetStatus {
  /** Whether there is remaining budget to generate another video. */
  canGenerate: boolean;
  /** Amount spent so far today in USD. */
  spent: number;
  /** Amount remaining before the hard cap in USD. */
  remaining: number;
  /** True when spend is >= 80 % of hard cap. */
  warning: boolean;
  /** True when spend is >= 95 % of hard cap. */
  critical: boolean;
}

// ─── Budget constants ─────────────────────────────────────────────────────────

// TODO: move to env / config.ts once those modules exist
const DAILY_HARD_CAP_USD: number =
  typeof (env as Record<string, unknown>)['DAILY_BUDGET_USD'] === 'number'
    ? Number((env as Record<string, unknown>)['DAILY_BUDGET_USD'])
    : 20;

const WARNING_THRESHOLD = 0.8;
const CRITICAL_THRESHOLD = 0.95;

// ─── In-process spend cache ───────────────────────────────────────────────────
// Avoids a DB round-trip on every budget check within the same process run.
let _cachedDate: string | null = null;
let _cachedSpend: number = 0;

function todayUtc(): string {
  return new Date().toISOString().split('T')[0]!;
}

function invalidateCache(date: string): void {
  if (_cachedDate !== date) {
    _cachedDate = date;
    _cachedSpend = 0;
  }
}

// ─── recordCost ───────────────────────────────────────────────────────────────

/**
 * Inserts a cost record. The Postgres trigger (fn_update_daily_spend) updates
 * daily_spend automatically; this function also updates the in-process cache
 * and fires Telegram alerts when thresholds are crossed.
 */
export async function recordCost(params: RecordCostParams): Promise<CostRecord> {
  const veoCost = params.veoCost ?? 0;
  const claudeCost = params.claudeCost ?? 0;
  const cloudinaryCost = params.cloudinaryCost ?? 0;
  const totalCost = veoCost + claudeCost + cloudinaryCost;

  const row = await dbInsert('costs', {
    video_id: params.videoId ?? null,
    scene_id: params.sceneId ?? null,
    veo_cost: veoCost,
    claude_cost: claudeCost,
    cloudinary_cost: cloudinaryCost,
    total_cost: totalCost,
    veo_variant: params.veoVariant ?? null,
    notes: params.notes ?? null,
  });

  // Update in-process cache
  const today = todayUtc();
  invalidateCache(today);
  _cachedSpend += totalCost;

  logger.info('Cost recorded', {
    videoId: params.videoId,
    sceneId: params.sceneId,
    totalCost,
    dailyRunning: _cachedSpend,
  });

  // Alert if thresholds crossed
  const ratio = _cachedSpend / DAILY_HARD_CAP_USD;
  if (ratio >= CRITICAL_THRESHOLD) {
    await telegram.error(
      `Budget CRITICAL: $${_cachedSpend.toFixed(2)} / $${DAILY_HARD_CAP_USD} ` +
        `(${Math.round(ratio * 100)}%) — generation paused until midnight UTC`,
    );
  } else if (ratio >= WARNING_THRESHOLD) {
    await telegram.alert(
      `Budget warning: $${_cachedSpend.toFixed(2)} / $${DAILY_HARD_CAP_USD} ` +
        `(${Math.round(ratio * 100)}%)`,
    );
  }

  return row as unknown as CostRecord;
}

// ─── getDailySpend ────────────────────────────────────────────────────────────

/**
 * Returns the daily_spend record for a given date (ISO YYYY-MM-DD).
 * Defaults to today UTC when called without arguments.
 */
export async function getDailySpend(date?: string): Promise<DailySpendRecord | null> {
  const targetDate = date ?? todayUtc();
  const rows = await dbSelect('daily_spend', { date: targetDate });
  if (!rows.length) return null;
  return rows[0] as unknown as DailySpendRecord;
}

// ─── checkBudget ─────────────────────────────────────────────────────────────

/**
 * Returns a structured budget status object. Prefers the in-process cache for
 * the current calendar day; falls back to a DB read when stale or cold.
 */
export async function checkBudget(): Promise<BudgetStatus> {
  const today = todayUtc();
  invalidateCache(today);

  // Warm cache from DB if this is the first check today
  if (_cachedSpend === 0) {
    const record = await getDailySpend(today);
    if (record) {
      _cachedSpend = Number(record.grand_total);
    }
  }

  const spent = _cachedSpend;
  const remaining = Math.max(0, DAILY_HARD_CAP_USD - spent);
  const ratio = spent / DAILY_HARD_CAP_USD;

  return {
    canGenerate: spent < DAILY_HARD_CAP_USD,
    spent,
    remaining,
    warning: ratio >= WARNING_THRESHOLD,
    critical: ratio >= CRITICAL_THRESHOLD,
  };
}

// ─── getCostPerView ───────────────────────────────────────────────────────────

/**
 * Returns cost-per-view for a video as a USD efficiency metric.
 * Fetches total costs for the video and the latest analytics view count.
 *
 * Returns null if the video has no cost records or no analytics yet.
 */
export async function getCostPerView(videoId: string): Promise<number | null> {
  // Sum all costs for this video
  const costRows = await dbSelect('costs', { video_id: videoId });
  if (!costRows.length) return null;

  const totalCost = costRows.reduce(
    (sum, r) => sum + Number((r as Partial<CostRecord>).total_cost ?? 0),
    0,
  );

  // Get the latest analytics snapshot (highest view count across all platforms)
  // TODO: replace with a proper MAX(views) query via Supabase RPC once the
  // client supports aggregation without raw SQL.
  const analyticsRows = await dbSelectFiltered('analytics', (q) =>
    q
      .eq('video_id', videoId)
      .order('checked_at', { ascending: false })
      .limit(10),
  );

  if (!analyticsRows.length) return null;

  const maxViews = analyticsRows.reduce(
    (max, r) => Math.max(max, Number((r as { views?: number }).views ?? 0)),
    0,
  );

  if (maxViews === 0) return null;

  const cpv = totalCost / maxViews;
  logger.info('Cost-per-view calculated', { videoId, totalCost, maxViews, cpv });
  return cpv;
}
