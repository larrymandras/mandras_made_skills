/**
 * Audio utilities — strip, normalize, analyze.
 */
import { logger } from '../utils/logger.js';

export async function stripAudioTrack(
  videoPath: string,
  outputPath: string,
): Promise<string> {
  logger.info('Audio: stripping audio track');
  // TODO: ffmpeg -i videoPath -an -c:v copy outputPath
  throw new Error('stripAudioTrack not implemented');
}

export async function normalizeAudio(
  audioPath: string,
  outputPath: string,
): Promise<string> {
  logger.info('Audio: normalizing loudness');
  // TODO: ffmpeg -i audioPath -af loudnorm=I=-16:TP=-1.5:LRA=11 outputPath
  throw new Error('normalizeAudio not implemented');
}

export async function getMosScore(audioPath: string): Promise<number> {
  logger.info('Audio: calculating MOS score');
  // TODO: analyze audio quality metrics, return score 0.0-1.0
  // Simple proxy: check for clipping, silence ratio, SNR estimate
  throw new Error('getMosScore not implemented');
}

export async function getFundamentalFrequency(audioPath: string): Promise<number> {
  logger.info('Audio: detecting fundamental frequency');
  // TODO: FFT analysis to detect dominant frequency in Hz
  throw new Error('getFundamentalFrequency not implemented');
}
