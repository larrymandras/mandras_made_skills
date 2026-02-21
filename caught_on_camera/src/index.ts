/**
 * Caught on Camera — entry point.
 *
 * Runs as a persistent Node.js process using node-cron for scheduled tasks.
 * Also listens for incoming Telegram bot commands via long-polling.
 *
 * Exported functions allow the CLI skill to trigger individual pipeline stages.
 */
import cron from 'node-cron';
import { logger } from './utils/logger.js';
import { runDailyPipeline, runIdeators, runAnalytics } from './pipeline/index.js';
import { handleTelegramCommand, sendAlert } from './monitoring/telegram.js';
import { env } from './config.js';

// ── Telegram long-poll ────────────────────────────────────────────────────────

let lastUpdateId = 0;

async function pollTelegramCommands(): Promise<void> {
  try {
    const url =
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates` +
      `?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["message"]`;

    const res = await fetch(url);
    if (!res.ok) return;

    const json = await res.json() as {
      ok: boolean;
      result: Array<{
        update_id: number;
        message?: { text?: string; chat?: { id: number } };
      }>;
    };

    if (!json.ok) return;

    for (const update of json.result) {
      lastUpdateId = update.update_id;
      const text = update.message?.text?.trim();
      if (!text?.startsWith('/')) continue;

      logger.info('Telegram: received command', { text });
      try {
        const reply = await handleTelegramCommand(text);
        // Send reply via Telegram sendMessage
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id:    env.TELEGRAM_CHAT_ID,
            text:       reply,
            parse_mode: 'HTML',
          }),
        });
      } catch (err) {
        logger.error('Telegram: command handler error', { text, err });
      }
    }
  } catch (err) {
    logger.warn('Telegram: poll failed (will retry)', { err });
  }
}

// ── Cron schedules ────────────────────────────────────────────────────────────

function startCron(): void {
  // Main pipeline: run every hour during production window (8am–10pm UTC)
  // The pipeline itself has budget and buffer gates to prevent over-generation
  cron.schedule('0 8-22 * * *', async () => {
    logger.info('Cron: triggering daily pipeline');
    await runDailyPipeline().catch((err) => {
      logger.error('Cron: pipeline error', { err });
      void sendAlert(`Pipeline cron error: ${String(err)}`, 'critical');
    });
  });

  // Ideators: run once daily at 6am UTC to keep idea queues topped up
  cron.schedule('0 6 * * *', async () => {
    logger.info('Cron: triggering ideators');
    await runIdeators().catch((err) => {
      logger.error('Cron: ideator error', { err });
    });
  });

  // Analytics: run once daily at midnight UTC
  cron.schedule('0 0 * * *', async () => {
    logger.info('Cron: triggering analytics');
    await runAnalytics().catch((err) => {
      logger.error('Cron: analytics error', { err });
    });
  });

  logger.info('Cron: schedules registered');
}

// ── Telegram polling loop ─────────────────────────────────────────────────────

function startTelegramPolling(): void {
  // Poll every 5 seconds for operator commands
  const POLL_INTERVAL_MS = 5_000;

  const loop = () => {
    void pollTelegramCommands().finally(() => {
      setTimeout(loop, POLL_INTERVAL_MS);
    });
  };

  loop();
  logger.info('Telegram: long-poll loop started');
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

const [,, command] = process.argv;

async function main(): Promise<void> {
  logger.info('Caught on Camera: starting', { command: command ?? 'server' });

  switch (command) {
    case 'run':
      // Single pipeline run (for manual invocation / testing)
      await runDailyPipeline();
      break;

    case 'ideate':
      // Single ideator run
      await runIdeators();
      break;

    case 'analytics':
      // Single analytics run
      await runAnalytics();
      break;

    case undefined:
    case 'server':
    default:
      // Server mode: cron + Telegram polling
      startCron();
      startTelegramPolling();
      await sendAlert('Caught on Camera server started.', 'info');
      logger.info('Caught on Camera: server mode running');
      // Keep the process alive
      break;
  }
}

main().catch((err) => {
  logger.error('Fatal startup error', { err });
  process.exit(1);
});

// ── Exports for skill integration ─────────────────────────────────────────────

export { runDailyPipeline, runIdeators, runAnalytics };
