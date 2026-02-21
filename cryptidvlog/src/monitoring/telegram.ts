import { env } from '../config.js';
import { logger } from '../utils/logger.js';

const BASE = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

async function send(text: string): Promise<void> {
  try {
    const res = await fetch(`${BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) logger.warn('Telegram send failed', { status: res.status });
  } catch (err) {
    logger.warn('Telegram unreachable', { error: String(err) });
  }
}

export const telegram = {
  alert:  (msg: string) => send(`⚠️ ${msg}`),
  info:   (msg: string) => send(`ℹ️ ${msg}`),
  error:  (msg: string) => send(`🚨 ${msg}`),

  reviewRequest: (p: {
    videoId: string; conceptTitle: string; sceneCount: number;
    cost: number; abStatus: string; previewUrl?: string;
  }) => send(
    `🎬 <b>New video ready for review</b>\n` +
    `ID: <code>${p.videoId}</code>\n` +
    `Concept: ${p.conceptTitle}\n` +
    `Scenes: ${p.sceneCount} passed all gates\n` +
    `Cost: $${p.cost.toFixed(2)}\n` +
    `A/B: ${p.abStatus}\n` +
    (p.previewUrl ? `Preview: ${p.previewUrl}\n` : '') +
    `\nReply:\n  ✅ approve ${p.videoId}\n  ❌ reject ${p.videoId} [reason]`
  ),
};
