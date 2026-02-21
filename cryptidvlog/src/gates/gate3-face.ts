/**
 * Gate 3 — Face / Body Detection
 * Ensures the cryptid character body is visible in the majority of frames.
 */
import { runVisionAnalysis } from '../ai/claude.js';
import { logger } from '../utils/logger.js';

export interface Gate3Result {
  pass: boolean;
  visibilityPercent: number;
}

export async function runGate3(
  frameBase64Images: string[],
  characterName: string,
): Promise<Gate3Result> {
  logger.info('Gate 3: body detection check', { characterName });
  // TODO: check each frame for character body visibility (>=30% body visible per frame),
  //       pass if >50% of frames have visible body
  throw new Error('Gate 3 not implemented');
}
