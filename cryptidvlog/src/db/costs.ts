/**
 * Cost tracking DB operations — record costs, check budget, alert on cap approach.
 */
import { dbInsert, dbSelect } from './client.js';
import { logger } from '../utils/logger.js';
import { BUDGET } from '../config.js';
import { telegram } from '../monitoring/telegram.js';

export async function recordSceneCost(params: {
  sceneId: string;
  vendor: string;
  operation: string;
  costUsd: number;
  tokensUsed?: number;
}): Promise<void> {
  await dbInsert('scene_costs', {
    scene_id: params.sceneId,
    vendor: params.vendor,
    operation: params.operation,
    cost_usd: params.costUsd,
    tokens_used: params.tokensUsed ?? null,
  });
}

export async function getDailySpend(date: string): Promise<number> {
  const rows = await dbSelect('daily_budget_log', { date });
  return Number((rows[0] as { total_cost_usd?: number } | undefined)?.total_cost_usd ?? 0);
}

export async function checkBudgetCap(): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0]!;
  const spend = await getDailySpend(today);
  logger.info('Budget check', { spend, cap: BUDGET.hardCap });
  return spend < BUDGET.hardCap;
}

export async function alertIfNearCap(spend: number): Promise<void> {
  const pct = spend / BUDGET.hardCap;
  if (pct >= 0.95) {
    await telegram.error(`Budget critical: $${spend.toFixed(2)} / $${BUDGET.hardCap} (${Math.round(pct * 100)}%)`);
  } else if (pct >= 0.80) {
    await telegram.alert(`Budget warning: $${spend.toFixed(2)} / $${BUDGET.hardCap} (${Math.round(pct * 100)}%)`);
  }
}
