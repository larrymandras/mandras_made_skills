/**
 * Producer — generates video and audio for each scene.
 * Per-scene: video generation → voice synthesis → Gates 1, 2, 3.
 * Retries once on gate failure. Marks scene 'degraded' if retry fails (does not abort).
 */
import { logger } from '../utils/logger.js';
import { generateSceneClip } from '../ai/veo.js';
import { synthesizeNarration } from '../ai/voice.js';
import { runGate1, runGate2, runGate3 } from '../gates/index.js';
import { extractFrames, frameToBase64 } from '../media/frames.js';
import type { SceneScript } from './scriptwriter.js';

export interface ProducedScene {
  sceneIndex: number;
  videoPath: string;
  audioPath: string;
  status: 'gates_passed' | 'degraded' | 'failed';
  gate1Score: number;
}

export async function produceScenes(
  videoId: string,
  scripts: SceneScript[],
  characterName: string,
): Promise<ProducedScene[]> {
  logger.info('Producer: generating scenes', { videoId, count: scripts.length });
  // TODO: for each scene: generateSceneClip → synthesizeNarration → extractFrames →
  //       runGate1 + runGate2 + runGate3, retry once on failure,
  //       mark degraded if retry fails, collect results
  throw new Error('Producer not implemented');
}
