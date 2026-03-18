/**
 * CLI entry point — routes commands to pipeline handlers.
 * Used by the skill and cron scripts.
 */
import { runPipeline } from './pipeline/index.js';
import { characterCommand } from './commands/character.js';
import { logger } from './utils/logger.js';

const [,, command, ...rest] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case 'run':
      await runPipeline();
      break;
    case 'character':
      await characterCommand(rest);
      break;
    default:
      logger.error(`Unknown command: ${command ?? '(none)'}. Use: run | character`);
      process.exit(1);
  }
}

main().catch((err) => {
  logger.error('Fatal', { err });
  process.exit(1);
});
