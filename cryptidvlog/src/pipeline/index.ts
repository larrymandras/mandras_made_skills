/**
 * Pipeline orchestrator — coordinates all pipeline stages end-to-end.
 * Called by the skill's /cryptidvlog run command.
 */
import { logger } from '../utils/logger.js';
import { generateConcept } from './ideator.js';
import { writeScript } from './scriptwriter.js';
import { produceScenes } from './producer.js';
import { assembleVideo } from './assembler.js';
import { telegram } from '../monitoring/telegram.js';
import { checkBudgetCap, getDailySpend } from '../db/costs.js';
import { isBufferHealthy } from '../monitoring/buffer.js';
import { dbInsert } from '../db/client.js';
import { runGate4, runGate7 } from '../gates/index.js';
import { env } from '../config.js';

export async function runPipeline(): Promise<void> {
  logger.info('Pipeline: starting run');

  // Step 1: budget check
  const budgetOk = await checkBudgetCap();
  if (!budgetOk) {
    logger.warn('Pipeline: daily hard cap reached — aborting');
    return;
  }

  // Step 2: buffer check
  const healthy = await isBufferHealthy();
  if (healthy) {
    logger.info('Pipeline: buffer healthy — skipping generation');
    return;
  }

  try {
    const concept = await generateConcept();
    const scripts = await writeScript(concept);

    // Step 3: create video record
    const videoRecord = await dbInsert('videos', {
      concept_title: concept.conceptTitle,
      hook: concept.hook,
      scene_count: concept.sceneCount,
      character_focus: concept.characterFocus,
      status: 'generating',
    });
    const videoId = videoRecord['id'] as string;

    // Step 4: produce scenes
    const scenes = await produceScenes(videoId, scripts, concept.characterFocus);
    if (scenes.every((s) => s.status === 'failed')) {
      await telegram.error(`Pipeline: all scenes failed for video ${videoId}`);
      return;
    }

    // Step 5: full-video gates (4 + 7)
    // TODO: run gate4 and gate7 on assembled video — abort on hard fail

    // Step 6: assemble
    const assembled = await assembleVideo(videoId, scenes);

    // Step 7: send for human review
    await telegram.reviewRequest({
      videoId,
      conceptTitle: concept.conceptTitle,
      sceneCount: scenes.filter((s) => s.status !== 'failed').length,
      cost: 0, // TODO: sum from cost tracking
    });

    logger.info('Pipeline: complete — awaiting human review', { videoId });
  } catch (err) {
    logger.error('Pipeline: fatal error', { err });
    await telegram.error(`Pipeline failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
