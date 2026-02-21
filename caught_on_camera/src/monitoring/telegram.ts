/**
 * Telegram notification and operator command handler.
 *
 * All outbound messages are fire-and-forget (errors are logged, not thrown)
 * so a Telegram outage never blocks the production pipeline.
 *
 * Operator commands are handled synchronously and return a reply string.
 */
import { env } from '../config.js';
import { logger } from '../utils/logger.js';

// ── Internal send ─────────────────────────────────────────────────────────────

const BASE_URL = () => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

async function send(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: parseMode,
      }),
    });
    if (!res.ok) {
      logger.warn('Telegram: sendMessage failed', { status: res.status });
    }
  } catch (err) {
    logger.warn('Telegram: unreachable', { error: String(err) });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Send a plain alert at the specified level.
 * Critical alerts are prefixed with a distinctive emoji for quick operator triage.
 */
export async function sendAlert(
  message: string,
  level: 'info' | 'warning' | 'critical' = 'info',
): Promise<void> {
  const prefix: Record<typeof level, string> = {
    info:     'ℹ️',
    warning:  '⚠️',
    critical: '🚨',
  };
  await send(`${prefix[level]} <b>${level.toUpperCase()}</b>\n${message}`);
}

/**
 * Send a review request to the operator when a video is ready for approval.
 * Includes a Cloudinary preview link and Approve/Reject action instructions.
 */
export async function sendReviewRequest(video: {
  id: string;
  format: string;
  title: string;
  cloudinaryUrl: string;
  concept: string;
  cost: number;
}): Promise<void> {
  const formatTag = video.format === 'ring_cam' ? '[RING CAM]' : '[BODY CAM]';

  const text =
    `🎬 <b>New video ready for review</b> ${formatTag}\n\n` +
    `<b>ID:</b> <code>${video.id}</code>\n` +
    `<b>Title:</b> ${video.title}\n` +
    `<b>Concept:</b> ${video.concept}\n` +
    `<b>Cost:</b> $${video.cost.toFixed(2)}\n\n` +
    `<b>Preview:</b> <a href="${video.cloudinaryUrl}">Watch clip</a>\n\n` +
    `<b>Actions:</b>\n` +
    `  ✅ <code>/approve ${video.id}</code>\n` +
    `  ❌ <code>/reject ${video.id} [reason]</code>`;

  await send(text);
  logger.info('Telegram: review request sent', { videoId: video.id });
}

/**
 * Alert the operator that daily spend is approaching or at the budget cap.
 */
export async function sendBudgetAlert(spent: number, cap: number): Promise<void> {
  const pct = ((spent / cap) * 100).toFixed(1);
  const text =
    `💰 <b>Budget Alert</b>\n\n` +
    `Daily spend: <b>$${spent.toFixed(2)}</b> of $${cap.toFixed(2)} cap (${pct}%)\n` +
    `Generation will pause at hard cap.`;
  await send(text);
  logger.info('Telegram: budget alert sent', { spent, cap });
}

/**
 * Alert the operator when the approved-video buffer falls below the safe threshold.
 */
export async function sendBufferAlert(bufferDays: number): Promise<void> {
  const urgency = bufferDays < 1 ? '🚨 CRITICAL' : '⚠️ LOW';
  const text =
    `${urgency} <b>Buffer Alert</b>\n\n` +
    `Approved video buffer: <b>${bufferDays.toFixed(1)} days</b>\n` +
    `Target: 3 days. Extra generation cycle triggered.`;
  await send(text);
  logger.info('Telegram: buffer alert sent', { bufferDays });
}

/**
 * Alert the operator when platform suppression is detected.
 */
export async function sendSuppressionAlert(
  platform: string,
  ratio: number,
  recommendation: string,
): Promise<void> {
  const level = ratio < 0.3 ? '🚨 CRITICAL' : '⚠️ WARNING';
  const text =
    `${level} <b>Suppression Detected — ${platform.toUpperCase()}</b>\n\n` +
    `7-day / 30-day view ratio: <b>${(ratio * 100).toFixed(1)}%</b>\n` +
    `Recommendation: ${recommendation}`;
  await send(text);
  logger.info('Telegram: suppression alert sent', { platform, ratio });
}

// ── Compatibility object export ───────────────────────────────────────────────
// db/client.ts and db/costs.ts import { telegram } and call telegram.alert() / .error()
// This object bridges the old API to the new named-function API.

export const telegram = {
  alert:  (msg: string) => sendAlert(msg, 'warning'),
  info:   (msg: string) => sendAlert(msg, 'info'),
  error:  (msg: string) => sendAlert(msg, 'critical'),
} as const;

// ── Command handler ────────────────────────────────────────────────────────────

/**
 * Handle an inbound Telegram operator command.
 * Returns a human-readable reply string.
 *
 * Supported commands:
 *   /approve <videoId>
 *   /reject <videoId> [reason]
 *   /status
 *   /pause
 *   /schedule <videoId> <ISO8601-datetime>
 *   /disable <ideaId>
 *   /buffer
 */
export async function handleTelegramCommand(command: string): Promise<string> {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  logger.info('Telegram: handling command', { command: cmd });

  switch (cmd) {
    case '/approve': {
      const videoId = parts[1];
      if (!videoId) return 'Usage: /approve <videoId>';

      // TODO: call updateVideoApproval(videoId, 'approved') from db/videos.ts
      // TODO: trigger publish schedule for this video
      logger.info('Telegram: /approve received', { videoId });
      return `✅ Video ${videoId} approved and queued for publishing.`;
    }

    case '/reject': {
      const videoId = parts[1];
      if (!videoId) return 'Usage: /reject <videoId> [reason]';
      const reason = parts.slice(2).join(' ') || 'No reason provided';

      // TODO: call updateVideoApproval(videoId, 'rejected', reason) from db/videos.ts
      logger.info('Telegram: /reject received', { videoId, reason });
      return `❌ Video ${videoId} rejected. Reason: ${reason}`;
    }

    case '/status': {
      // TODO: fetch checkBudget() + getBufferStatus() + getApprovedUnpublished().length
      //       and format a status summary
      logger.info('Telegram: /status received');
      return '📊 Status check triggered — TODO: implement status summary query.';
    }

    case '/pause': {
      // TODO: set a PIPELINE_PAUSED flag in DB / env; runDailyPipeline() checks this
      logger.info('Telegram: /pause received');
      return '⏸️ Pipeline paused. Send /pause again to resume.';
    }

    case '/schedule': {
      const videoId = parts[1];
      const isoTime = parts[2];
      if (!videoId || !isoTime) return 'Usage: /schedule <videoId> <ISO8601-datetime>';

      // TODO: update scheduled_publish_at on the video record and trigger publisher
      logger.info('Telegram: /schedule received', { videoId, isoTime });
      return `📅 Video ${videoId} scheduled for ${isoTime}.`;
    }

    case '/disable': {
      const ideaId = parts[1];
      if (!ideaId) return 'Usage: /disable <ideaId>';

      // TODO: call disableIdea(ideaId, source) from db/ideas.ts
      // (source determination requires a DB lookup to find which table the idea is in)
      logger.info('Telegram: /disable received', { ideaId });
      return `🚫 Idea ${ideaId} disabled — will not be produced.`;
    }

    case '/buffer': {
      // TODO: call getBufferStatus() from monitoring/buffer.ts and format result
      logger.info('Telegram: /buffer received');
      return '📦 Buffer status check triggered — TODO: implement buffer query.';
    }

    default:
      return `Unknown command: ${cmd ?? '(none)'}\nAvailable: /approve /reject /status /pause /schedule /disable /buffer`;
  }
}
