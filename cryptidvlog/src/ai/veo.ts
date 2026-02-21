/**
 * Video generation — fal.ai Veo 3.1 primary, Replicate fallback, slideshow last resort.
 * Never import this directly in gates — use only in pipeline/producer.ts.
 */
import { logger } from '../utils/logger.js';
import { telegram } from '../monitoring/telegram.js';
import { env } from '../config.js';

export interface VideoGenInput {
  prompt: string;
  referenceImageBase64?: string;
  durationSeconds?: number;
}

export async function generateSceneClip(
  input: VideoGenInput,
  outputPath: string,
): Promise<string> {
  logger.info('Veo: generating scene clip');
  try {
    return await falAiGenerate(input, outputPath);
  } catch (err) {
    logger.warn('fal.ai failed — trying Replicate', { err });
    try {
      return await replicateGenerate(input, outputPath);
    } catch (err2) {
      logger.warn('Replicate failed — slideshow fallback', { err2 });
      await telegram.alert('All video vendors down — using slideshow fallback.');
      return await slideshowFallback(input, outputPath);
    }
  }
}

async function falAiGenerate(input: VideoGenInput, outputPath: string): Promise<string> {
  // TODO: POST to fal.ai /fal-ai/veo3 endpoint with FAL_API_KEY,
  //       use reference_image_url if referenceImageBase64 provided (ref-to-video),
  //       poll for result, download video to outputPath
  throw new Error('fal.ai generate not implemented');
}

async function replicateGenerate(input: VideoGenInput, outputPath: string): Promise<string> {
  // TODO: POST to Replicate API with model ID, poll prediction, download to outputPath
  throw new Error('Replicate generate not implemented');
}

async function slideshowFallback(input: VideoGenInput, outputPath: string): Promise<string> {
  // TODO: load character reference images, create slideshow with ffmpeg
  //       (each image shown for 2s with ken burns pan effect), save to outputPath
  throw new Error('slideshow fallback not implemented');
}
