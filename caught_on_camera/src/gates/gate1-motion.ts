/**
 * Gate 1: Motion Analysis Gate
 * Ring Cam: REJECT if camera moves (avg motion > 0.5px, max spike > 2.0px)
 * Body Cam: REJECT if too stable (avg motion < 1.5px/frame) — then add synthetic shake
 * Uses FFmpeg vidstabdetect to analyze optical flow motion vectors
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';

export interface Gate1Result {
  pass: boolean;
  action?: 'add_shake' | 'regenerate';
  avgMotion: number;
  maxMotion: number;
  reason?: string;
}

const TRF_PATH = '/tmp/motion.trf';

function parseTrfFile(trfPath: string): { avgMotion: number; maxMotion: number } {
  if (!fs.existsSync(trfPath)) {
    logger.warn('Gate 1: motion.trf not found, defaulting to zero motion');
    return { avgMotion: 0, maxMotion: 0 };
  }

  const content = fs.readFileSync(trfPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));

  const motionValues: number[] = [];

  for (const line of lines) {
    // vidstabdetect trf format: frameNum dx dy dRotate dZoom dSkew contrast match
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3) {
      const dx = parseFloat(parts[1] ?? '0');
      const dy = parseFloat(parts[2] ?? '0');
      if (!isNaN(dx) && !isNaN(dy)) {
        const magnitude = Math.sqrt(dx * dx + dy * dy);
        motionValues.push(magnitude);
      }
    }
  }

  if (motionValues.length === 0) {
    return { avgMotion: 0, maxMotion: 0 };
  }

  const avgMotion = motionValues.reduce((sum, v) => sum + v, 0) / motionValues.length;
  const maxMotion = Math.max(...motionValues);

  return { avgMotion, maxMotion };
}

export async function runGate1(
  videoPath: string,
  format: 'ring_cam' | 'body_cam',
): Promise<Gate1Result> {
  logger.info('Gate 1: motion analysis starting', { videoPath, format });

  // Clean up any existing trf file
  if (fs.existsSync(TRF_PATH)) {
    fs.unlinkSync(TRF_PATH);
  }

  try {
    // Run ffmpeg vidstabdetect to analyze optical flow motion vectors
    execSync(
      `ffmpeg -i "${videoPath}" -vf "vidstabdetect=result=${TRF_PATH}:shakiness=10:accuracy=15" -f null -`,
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    // ffmpeg exits non-zero with -f null even on success; check if trf was written
    if (!fs.existsSync(TRF_PATH)) {
      logger.error('Gate 1: vidstabdetect failed to produce trf file', { err });
      return {
        pass: false,
        action: 'regenerate',
        avgMotion: 0,
        maxMotion: 0,
        reason: 'vidstabdetect failed — could not analyze motion vectors',
      };
    }
  }

  const { avgMotion, maxMotion } = parseTrfFile(TRF_PATH);

  logger.info('Gate 1: motion analysis results', { avgMotion, maxMotion, format });

  if (format === 'ring_cam') {
    // Ring cam must be static — any camera movement is a fail
    const pass = avgMotion < 0.5 && maxMotion < 2.0;
    if (pass) {
      logger.info('Gate 1: ring_cam PASS — camera is static', { avgMotion, maxMotion });
      return { pass: true, avgMotion, maxMotion };
    } else {
      const reason =
        avgMotion >= 0.5
          ? `avgMotion ${avgMotion.toFixed(3)}px exceeds ring_cam limit of 0.5px`
          : `maxMotion spike ${maxMotion.toFixed(3)}px exceeds ring_cam limit of 2.0px`;
      logger.warn('Gate 1: ring_cam FAIL — camera movement detected', { avgMotion, maxMotion, reason });
      return { pass: false, action: 'regenerate', avgMotion, maxMotion, reason };
    }
  } else {
    // Body cam must have organic walking motion
    if (avgMotion >= 1.5) {
      logger.info('Gate 1: body_cam PASS — sufficient walking motion detected', { avgMotion, maxMotion });
      return { pass: true, avgMotion, maxMotion };
    } else {
      const reason = `avgMotion ${avgMotion.toFixed(3)}px is below body_cam minimum of 1.5px/frame — synthetic shake required`;
      logger.warn('Gate 1: body_cam FAIL — too stable, adding synthetic shake', { avgMotion, maxMotion, reason });
      return { pass: false, action: 'add_shake', avgMotion, maxMotion, reason };
    }
  }
}
