/**
 * Assembler — combines produced scenes into a single final video.
 * Order: concat → audio mix → crop safe zone → burn watermark + disclosure.
 */
import { logger } from '../utils/logger.js';
import { concatenateScenes, mixAudio, applyCropSafeZone, burnWatermark } from '../media/ffmpeg.js';
import type { ProducedScene } from './producer.js';

export interface AssembledVideo {
  videoPath: string;
  durationSeconds: number;
}

export async function assembleVideo(
  videoId: string,
  scenes: ProducedScene[],
): Promise<AssembledVideo> {
  logger.info('Assembler: assembling final video', { videoId, sceneCount: scenes.length });
  // TODO: pick a random music track from assets/music/,
  //       concatenateScenes → mixAudio → applyCropSafeZone → burnWatermark,
  //       probe output duration, return AssembledVideo
  throw new Error('Assembler not implemented');
}
