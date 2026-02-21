/**
 * FFmpeg utilities — concatenation, audio mixing, crop, watermark.
 * All functions return the output path on success; throw on non-zero exit.
 */
import { logger } from '../utils/logger.js';

export async function concatenateScenes(
  scenePaths: string[],
  outputPath: string,
): Promise<string> {
  logger.info('FFmpeg: concatenating scenes', { count: scenePaths.length });
  // TODO: write ffmpeg concat demuxer file, run:
  //   ffmpeg -f concat -safe 0 -i list.txt -c copy outputPath
  throw new Error('concatenateScenes not implemented');
}

export async function mixAudio(
  videoPath: string,
  musicPath: string,
  outputPath: string,
  musicVolumeDb = -18,
): Promise<string> {
  logger.info('FFmpeg: mixing audio', { musicVolumeDb });
  // TODO: ffmpeg -i videoPath -i musicPath
  //   -filter_complex "[1:a]volume=${musicVolumeDb}dB[music];[0:a][music]amix=inputs=2[out]"
  //   -map 0:v -map "[out]" outputPath
  throw new Error('mixAudio not implemented');
}

export async function applyCropSafeZone(
  videoPath: string,
  outputPath: string,
  cropParams?: { x: number; y: number; width: number; height: number },
): Promise<string> {
  logger.info('FFmpeg: applying crop safe zone');
  // TODO: ffmpeg crop filter to 9:16 safe zone; use cropParams if provided
  throw new Error('applyCropSafeZone not implemented');
}

export async function burnWatermark(
  videoPath: string,
  outputPath: string,
  watermarkText = 'AI Generated',
): Promise<string> {
  logger.info('FFmpeg: burning watermark');
  // TODO: ffmpeg drawtext filter — bottom-right corner, semi-transparent white,
  //       also add "Synthetic Media" disclosure in smaller text at top
  throw new Error('burnWatermark not implemented');
}
