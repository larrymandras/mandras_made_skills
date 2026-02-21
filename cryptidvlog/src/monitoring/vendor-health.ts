/**
 * Vendor health monitor — polls status pages every 30 minutes, writes to DB.
 * Called by cron script; alert sent on first degradation per vendor.
 */
import { dbInsert } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { telegram } from './telegram.js';

interface VendorConfig {
  name: string;
  statusUrl: string;
  timeoutMs: number;
}

const VENDORS: VendorConfig[] = [
  { name: 'anthropic',  statusUrl: 'https://status.anthropic.com/api/v2/status.json',  timeoutMs: 5000 },
  { name: 'openai',     statusUrl: 'https://status.openai.com/api/v2/status.json',     timeoutMs: 5000 },
  { name: 'fal_ai',     statusUrl: 'https://status.fal.ai/api/v2/status.json',         timeoutMs: 5000 },
  { name: 'elevenlabs', statusUrl: 'https://status.elevenlabs.io/api/v2/status.json',  timeoutMs: 5000 },
  { name: 'supabase',   statusUrl: 'https://status.supabase.com/api/v2/status.json',   timeoutMs: 5000 },
];

export async function pollVendorHealth(): Promise<void> {
  logger.info('Vendor health: polling all vendors');
  await Promise.allSettled(VENDORS.map(checkVendor));
}

async function checkVendor(vendor: VendorConfig): Promise<void> {
  const start = Date.now();
  try {
    const res = await fetch(vendor.statusUrl, { signal: AbortSignal.timeout(vendor.timeoutMs) });
    const latencyMs = Date.now() - start;
    const status = !res.ok ? 'down' : latencyMs > 4000 ? 'degraded' : 'healthy';
    await dbInsert('vendor_health_log', { vendor_name: vendor.name, status, latency_ms: latencyMs });
    if (status !== 'healthy') {
      await telegram.alert(`Vendor ${vendor.name} is ${status} (${latencyMs}ms)`);
    }
  } catch (err) {
    await dbInsert('vendor_health_log', {
      vendor_name: vendor.name, status: 'down',
      error_message: err instanceof Error ? err.message : String(err),
    });
    await telegram.error(`Vendor ${vendor.name} unreachable`);
  }
}
