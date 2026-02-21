/**
 * Gate 1 — Character Consistency
 * Scores each scene against character reference images via Claude vision.
 * Score >= 95: auto-save as reference frame. Score < 70: mark scene degraded.
 */
import { runVisionAnalysis } from '../ai/claude.js';
import { logger } from '../utils/logger.js';
import { CONSISTENCY } from '../config.js';

export interface Gate1Result {
  pass: boolean;
  score: number;
  characterName: string;
  savedAsReference: boolean;
}

export async function runGate1(
  sceneId: string,
  characterName: string,
  frameBase64Images: string[],
): Promise<Gate1Result> {
  logger.info('Gate 1: character consistency check', { sceneId, characterName });
  // TODO: call runVisionAnalysis with frames + active reference images,
  //       parse integer score 0-100 from response,
  //       if score >= CONSISTENCY.saveAbove save frame as reference,
  //       return { pass: score >= CONSISTENCY.rejectBelow, score, characterName, savedAsReference }
  throw new Error('Gate 1 not implemented');
}
