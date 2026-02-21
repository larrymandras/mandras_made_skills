/**
 * Frame extraction — pull frames from video clips for gate analysis.
 */
import { logger } from '../utils/logger.js';
import { readFileSync } from 'fs';

export async function extractFrames(
  videoPath: string,
  outputDir: string,
  fps = 1,
): Promise<string[]> {
  logger.info('Frames: extracting', { videoPath, fps });
  // TODO: run: ffmpeg -i videoPath -vf "fps=N" outputDir/frame_%04d.jpg
  //       return sorted array of frame paths
  throw new Error('extractFrames not implemented');
}

export async function getBestFrame(framePaths: string[]): Promise<string> {
  logger.info('Frames: selecting best frame', { count: framePaths.length });
  // TODO: score each frame via sharp (laplacian variance = sharpness),
  //       return path of sharpest frame
  throw new Error('getBestFrame not implemented');
}

export async function frameToBase64(framePath: string): Promise<string> {
  const buf = readFileSync(framePath);
  return buf.toString('base64');
}
