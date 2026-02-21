/**
 * Cost monitoring — records spend and alerts on budget thresholds.
 */
import { recordSceneCost, getDailySpend, alertIfNearCap } from '../db/costs.js';
import { logger } from '../utils/logger.js';

export async function trackCost(params: {
  sceneId: string;
  vendor: string;
  operation: string;
  costUsd: number;
  tokensUsed?: number;
}): Promise<void> {
  await recordSceneCost(params);
  const today = new Date().toISOString().split('T')[0]!;
  const totalSpend = await getDailySpend(today);
  logger.info('Cost tracked', { vendor: params.vendor, cost: params.costUsd, dailyTotal: totalSpend });
  await alertIfNearCap(totalSpend);
}
