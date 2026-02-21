/**
 * Gate runner — executes all 7 gates in sequence
 * Gates 4 and 7 are HARD FAIL — any positive flag blocks immediately
 * Other gates: up to 3 retries before escalating to human review
 */
import { logger } from '../utils/logger.js';
import { runGate1, type Gate1Result } from './gate1-motion.js';
import { runGate2, type Gate2Result } from './gate2-face.js';
import { runGate3, type Gate3Result } from './gate3-audio.js';
import { runGate4, type Gate4Result } from './gate4-policy.js';
import { runGate5, type Gate5Result } from './gate5-crop.js';
import { runGate6, type Gate6Result } from './gate6-overlay.js';
import { runGate7, type Gate7Result } from './gate7-disclosure.js';

export {
  runGate1,
  runGate2,
  runGate3,
  runGate4,
  runGate5,
  runGate6,
  runGate7,
};

export type {
  Gate1Result,
  Gate2Result,
  Gate3Result,
  Gate4Result,
  Gate5Result,
  Gate6Result,
  Gate7Result,
};

export { sanitizePrompt } from './gate4-policy.js';
export type { SanitizeResult } from './gate4-policy.js';

export interface GateRunnerResult {
  pass: boolean;
  hardFail: boolean;
  hardFailGate?: number;
  cropSafe?: boolean;
  action?: string;
  recommendedBed?: string;
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
  videoPath: string;
  format: 'ring_cam' | 'body_cam';
  subType?: string;
  concept: string;
  frameBase64Images: string[];
}): Promise<GateRunnerResult> {
  const { sceneId, videoPath, format, subType, concept, frameBase64Images } = params;

  logger.info('Gate runner: starting all 7 gates', { sceneId, format });

  const result: GateRunnerResult = {
    pass: false,
    hardFail: false,
  };

  // ─── Gate 1: Motion Analysis ──────────────────────────────────────────────
  logger.info('Gate runner: running Gate 1 — motion analysis', { sceneId });
  let gate1: Gate1Result;
  try {
    gate1 = await runGate1(videoPath, format);
  } catch (err) {
    logger.error('Gate 1: unexpected error', { err, sceneId });
    return { ...result, gate1: { pass: false, avgMotion: 0, maxMotion: 0, action: 'regenerate', reason: 'gate1 threw an error' } };
  }
  result.gate1 = gate1;

  if (!gate1.pass) {
    if (gate1.action === 'add_shake') {
      // Body cam too stable — return shake action immediately so pipeline can apply it
      // This does not count as a gate failure requiring retry; shake is applied then re-run
      logger.info('Gate runner: Gate 1 requesting synthetic shake — returning action', { sceneId });
      return {
        ...result,
        pass: false,
        action: 'add_shake',
        gate1,
      };
    }
    // ring_cam camera movement — regenerate
    logger.warn('Gate runner: Gate 1 FAIL — camera movement detected, regenerate required', { sceneId });
    return { ...result, pass: false, action: 'regenerate', gate1 };
  }

  // ─── Gate 2: Face Detection (always passes) ───────────────────────────────
  logger.info('Gate runner: running Gate 2 — face detection', { sceneId });
  let gate2: Gate2Result;
  try {
    gate2 = await runGate2(videoPath);
  } catch (err) {
    logger.error('Gate 2: unexpected error (non-blocking)', { err, sceneId });
    gate2 = { pass: true, facesDetected: 0, framesWithFaces: 0, blurred: false };
  }
  result.gate2 = gate2;
  logger.info('Gate 2: audit log', {
    sceneId,
    facesDetected: gate2.facesDetected,
    framesWithFaces: gate2.framesWithFaces,
    blurred: gate2.blurred,
  });
  // Gate 2 always passes — blurred video path is surfaced for pipeline use but never blocks

  // If gate2 produced a blurred video, use that for subsequent gates
  const effectiveVideoPath = gate2.blurredVideoPath ?? videoPath;

  // ─── Gate 3: Audio Validation ─────────────────────────────────────────────
  logger.info('Gate runner: running Gate 3 — audio validation', { sceneId });
  let gate3: Gate3Result;
  try {
    gate3 = await runGate3(effectiveVideoPath, format, subType);
  } catch (err) {
    logger.error('Gate 3: unexpected error', { err, sceneId });
    return { ...result, gate2, gate3: { pass: false, meanVolume: -99, action: 'regenerate', reason: 'gate3 threw an error' } };
  }
  result.gate3 = gate3;

  if (!gate3.pass) {
    if (gate3.action === 'mix_bed') {
      // Body cam audio too quiet — return bed recommendation for pipeline to mix
      logger.info('Gate runner: Gate 3 requesting audio bed mix', {
        sceneId,
        recommendedBed: gate3.recommendedBed,
      });
      return {
        ...result,
        pass: false,
        action: 'mix_bed',
        recommendedBed: gate3.recommendedBed,
        gate2,
        gate3,
      };
    }
    // regenerate or replace_audio
    logger.warn('Gate runner: Gate 3 FAIL', { sceneId, action: gate3.action });
    return { ...result, pass: false, action: gate3.action, gate2, gate3 };
  }

  // ─── Gate 4: Content Policy (HARD FAIL) ──────────────────────────────────
  logger.info('Gate runner: running Gate 4 — content policy (HARD FAIL gate)', { sceneId });
  let gate4: Gate4Result;
  try {
    gate4 = await runGate4(effectiveVideoPath, format, concept, frameBase64Images);
  } catch (err) {
    logger.error('Gate 4: unexpected error — treating as hard fail for safety', { err, sceneId });
    return {
      ...result,
      hardFail: true,
      hardFailGate: 4,
      gate2,
      gate3,
      gate4: { pass: false, hardFail: true, severity: 'high', flags: ['gate4_error'], reason: 'gate4 threw an error' },
    };
  }
  result.gate4 = gate4;

  if (!gate4.pass) {
    if (gate4.hardFail) {
      logger.error('Gate runner: Gate 4 HARD FAIL — blocking clip permanently', {
        sceneId,
        severity: gate4.severity,
        flags: gate4.flags,
      });
      return {
        ...result,
        pass: false,
        hardFail: true,
        hardFailGate: 4,
        gate2,
        gate3,
        gate4,
      };
    }
    // Non-hard-fail policy issue (medium/low severity) — still blocks, requires retry
    logger.warn('Gate runner: Gate 4 FAIL — content flags present', { sceneId, flags: gate4.flags });
    return { ...result, pass: false, gate2, gate3, gate4 };
  }

  // ─── Gate 5: Crop Safety (always passes — attaches cropSafe) ─────────────
  logger.info('Gate runner: running Gate 5 — crop safety', { sceneId });
  let gate5: Gate5Result;
  try {
    gate5 = await runGate5(effectiveVideoPath, format);
  } catch (err) {
    logger.error('Gate 5: unexpected error (non-blocking — defaulting to crop-safe)', { err, sceneId });
    gate5 = { pass: true, cropSafe: true, recommendation: 'all_platforms' };
  }
  result.gate5 = gate5;
  result.cropSafe = gate5.cropSafe;

  // Gate 5 always returns pass:true — just records cropSafe for platform routing
  logger.info('Gate 5: crop safety recorded', {
    sceneId,
    cropSafe: gate5.cropSafe,
    recommendation: gate5.recommendation,
  });

  // ─── Gate 6: Overlay Quality ──────────────────────────────────────────────
  logger.info('Gate runner: running Gate 6 — overlay quality', { sceneId });
  let gate6: Gate6Result;
  try {
    gate6 = await runGate6(effectiveVideoPath, format);
  } catch (err) {
    logger.error('Gate 6: unexpected error', { err, sceneId });
    return {
      ...result,
      gate2,
      gate3,
      gate4,
      gate5,
      gate6: { pass: false, overlayDetected: false, timestampReadable: false, formatCorrect: false, reason: 'gate6 threw an error' },
    };
  }
  result.gate6 = gate6;

  if (!gate6.pass) {
    logger.warn('Gate runner: Gate 6 FAIL — overlay quality check failed', {
      sceneId,
      reason: gate6.reason,
    });
    return { ...result, pass: false, action: 'retry_overlay', gate2, gate3, gate4, gate5, gate6 };
  }

  // ─── Gate 7: AI Disclosure Watermark (HARD FAIL) ─────────────────────────
  logger.info('Gate runner: running Gate 7 — AI disclosure watermark (HARD FAIL gate)', { sceneId });
  let gate7: Gate7Result;
  try {
    gate7 = await runGate7(effectiveVideoPath);
  } catch (err) {
    logger.error('Gate 7: unexpected error — treating as hard fail for safety', { err, sceneId });
    return {
      ...result,
      hardFail: true,
      hardFailGate: 7,
      gate2,
      gate3,
      gate4,
      gate5,
      gate6,
      gate7: { pass: false, hardFail: true, watermarkDetected: false },
    };
  }
  result.gate7 = gate7;

  if (!gate7.pass) {
    logger.error('Gate runner: Gate 7 HARD FAIL — AI disclosure watermark missing', { sceneId });
    return {
      ...result,
      pass: false,
      hardFail: true,
      hardFailGate: 7,
      gate2,
      gate3,
      gate4,
      gate5,
      gate6,
      gate7,
    };
  }

  // ─── ALL GATES PASSED ─────────────────────────────────────────────────────
  logger.info('Gate runner: ALL GATES PASSED', {
    sceneId,
    cropSafe: gate5.cropSafe,
    facesBlurred: gate2.blurred,
    facesDetected: gate2.facesDetected,
  });

  return {
    pass: true,
    hardFail: false,
    cropSafe: gate5.cropSafe,
    gate1,
    gate2,
    gate3,
    gate4,
    gate5,
    gate6,
    gate7,
  };
}
