/**
 * Platform suppression detection.
 *
 * Compares last-7-day average views against the 30-day historical baseline for
 * each platform. A significant drop signals that the platform algorithm may be
 * suppressing the channel, and posting strategy should be adjusted.
 *
 * Severity thresholds:
 *   ratio < 0.3  → CRITICAL: reduce posting on that platform by 50%, boost others
 *   ratio < 0.6  → WARNING:  monitor closely
 *   ratio >= 0.6 → NORMAL
 */
import { dbSelectFiltered } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { sendSuppressionAlert } from './telegram.js';
import { PLATFORM_LIMITS } from '../config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SuppressionLevel = 'NORMAL' | 'WARNING' | 'CRITICAL';

export interface SuppressionResult {
  alert: SuppressionLevel;
  ratio: number;
  message: string;
  recommendation: string;
}

export interface PostingSchedule {
  youtube: number;
  tiktok: number;
  instagram: number;
  shorts: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Fetch average daily views for a platform over the given number of trailing days */
async function getAvgDailyViews(platform: string, days: number): Promise<number> {
  const cutoff = daysAgoIso(days);

  // TODO: replace with a proper SQL AVG aggregation via Supabase RPC
  // Assumes a `platform_analytics` table with columns: platform, date, views
  const rows = await dbSelectFiltered('platform_analytics', (q) =>
    q
      .eq('platform', platform)
      .gte('date', cutoff.split('T')[0]!)
      .select('views'),
  );

  if (rows.length === 0) return 0;
  const total = rows.reduce((s, r) => s + (Number(r['views']) || 0), 0);
  return total / rows.length;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Detect suppression on a single platform by comparing recent vs historical
 * average daily views.
 *
 * @param platform  Platform identifier: 'youtube' | 'tiktok' | 'instagram' | 'shorts'
 */
export async function detectSuppression(platform: string): Promise<SuppressionResult> {
  logger.info('Suppression: checking platform', { platform });

  const [avg7, avg30] = await Promise.all([
    getAvgDailyViews(platform, 7),
    getAvgDailyViews(platform, 30),
  ]);

  // Avoid division-by-zero: if 30-day baseline is zero there is no historical data
  if (avg30 === 0) {
    logger.warn('Suppression: no 30-day baseline available', { platform });
    return {
      alert: 'NORMAL',
      ratio: 1,
      message: `No 30-day baseline for ${platform} — cannot assess suppression.`,
      recommendation: 'Continue normal posting schedule.',
    };
  }

  const ratio = avg7 / avg30;

  logger.info('Suppression: view ratio computed', { platform, avg7, avg30, ratio });

  if (ratio < 0.3) {
    const recommendation =
      `Reduce ${platform} posting by 50%. Redistribute to other platforms until ratio recovers above 0.6.`;
    await sendSuppressionAlert(platform, ratio, recommendation);
    return {
      alert: 'CRITICAL',
      ratio,
      message: `${platform}: 7-day avg ${avg7.toFixed(0)} views vs 30-day avg ${avg30.toFixed(0)} (${(ratio * 100).toFixed(1)}% of baseline).`,
      recommendation,
    };
  }

  if (ratio < 0.6) {
    const recommendation =
      `Monitor ${platform} closely. Do not increase posting frequency until ratio recovers.`;
    await sendSuppressionAlert(platform, ratio, recommendation);
    return {
      alert: 'WARNING',
      ratio,
      message: `${platform}: 7-day avg ${avg7.toFixed(0)} views vs 30-day avg ${avg30.toFixed(0)} (${(ratio * 100).toFixed(1)}% of baseline).`,
      recommendation,
    };
  }

  return {
    alert: 'NORMAL',
    ratio,
    message: `${platform}: view ratio healthy at ${(ratio * 100).toFixed(1)}% of 30-day baseline.`,
    recommendation: 'No adjustment needed.',
  };
}

/**
 * Run suppression detection across all monitored platforms in parallel.
 * Returns a map of platform → SuppressionResult.
 */
export async function checkAllPlatforms(): Promise<Record<string, SuppressionResult>> {
  const platforms = ['youtube', 'tiktok', 'instagram', 'shorts'] as const;

  logger.info('Suppression: checking all platforms');

  const results = await Promise.all(
    platforms.map(async (p) => [p, await detectSuppression(p)] as [string, SuppressionResult]),
  );

  return Object.fromEntries(results);
}

/**
 * Compute adjusted per-platform daily posting limits based on suppression results.
 *
 * CRITICAL platforms have their limit halved; the freed capacity is spread
 * proportionally across non-critical platforms (up to each platform's hard cap).
 *
 * @param suppressionResults  Output of checkAllPlatforms().
 */
export function getPostingAdjustments(
  suppressionResults: Record<string, SuppressionResult>,
): PostingSchedule {
  // Start from config limits
  const schedule: PostingSchedule = {
    youtube:   PLATFORM_LIMITS.youtube.maxPerDay,
    tiktok:    PLATFORM_LIMITS.tiktok.maxPerDay,
    instagram: PLATFORM_LIMITS.instagram.maxPerDay,
    shorts:    PLATFORM_LIMITS.shorts.maxPerDay,
  };

  const platforms = Object.keys(schedule) as (keyof PostingSchedule)[];

  // Step 1: halve CRITICAL platforms
  let freedCapacity = 0;
  for (const platform of platforms) {
    const result = suppressionResults[platform];
    if (result?.alert === 'CRITICAL') {
      const original = schedule[platform];
      const reduced = Math.max(0, Math.floor(original / 2));
      freedCapacity += original - reduced;
      schedule[platform] = reduced;
      logger.info('Suppression: reduced posting limit', { platform, original, reduced });
    }
  }

  // Step 2: spread freed capacity across healthy platforms
  if (freedCapacity > 0) {
    const healthyPlatforms = platforms.filter(
      (p) => suppressionResults[p]?.alert !== 'CRITICAL',
    );

    for (const platform of healthyPlatforms) {
      if (freedCapacity <= 0) break;
      const hardCap = PLATFORM_LIMITS[platform].maxPerDay;
      const bonus = Math.min(1, freedCapacity); // add at most 1 per platform per pass
      const newLimit = Math.min(hardCap, schedule[platform] + bonus);
      freedCapacity -= newLimit - schedule[platform];
      schedule[platform] = newLimit;
    }
  }

  logger.info('Suppression: adjusted posting schedule', { schedule });
  return schedule;
}
