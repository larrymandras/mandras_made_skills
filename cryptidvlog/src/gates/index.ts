/**
 * Gate runner — executes all 7 gates in order, respecting hard-fail semantics.
 * Gates 4 and 7 are hard-fail: any positive flag blocks publish immediately.
 */
import { logger } from '../utils/logger.js';
import { runGate1, type Gate1Result } from './gate1-consistency.js';
import { runGate2, type Gate2Result } from './gate2-continuity.js';
import { runGate3, type Gate3Result } from './gate3-face.js';
import { runGate4, type Gate4Result } from './gate4-policy.js';
import { runGate5, type Gate5Result } from './gate5-voice.js';
import { runGate6, type Gate6Result } from './gate6-crop.js';
import { runGate7, type Gate7Result } from './gate7-watermark.js';

export {
  runGate1, runGate2, runGate3, runGate4,
  runGate5, runGate6, runGate7,
};

export interface GateRunnerResult {
  pass: boolean;
  hardFail: boolean;
  hardFailGate?: number;
  gate1?: Gate1Result;
  gate2?: Gate2Result;
  gate3?: Gate3Result;
  gate4?: Gate4Result;
  gate5?: Gate5Result;
  gate6?: Gate6Result;
  gate7?: Gate7Result;
}

export async function runAllGates(params: {
  sceneId: string;
  characterName: string;
  frameBase64Images: string[];
  videoPath: string;
  audioPath: string;
  scriptText: string;
  prevSceneLastFrameBase64?: string;
  currentSceneFirstFrameBase64?: string;
  targetPose?: string;
}): Promise<GateRunnerResult> {
  logger.info('Gate runner: starting all gates', { sceneId: params.sceneId });

  const result: GateRunnerResult = { pass: true, hardFail: false };

  // Gate 1 — Character Consistency
  const gate1 = await runGate1(
    params.sceneId,
    params.characterName,
    params.frameBase64Images,
    params.targetPose,
  );
  result.gate1 = gate1;
  if (!gate1.pass) {
    result.pass = false;
  }

  // TODO: Gate 2 — Continuity
  // TODO: Gate 3 — Face detection
  // TODO: Gate 4 — Policy (hard-fail)
  // TODO: Gate 5 — Voice consistency
  // TODO: Gate 6 — Crop / framing
  // TODO: Gate 7 — Watermark (hard-fail)

  return result;
}
