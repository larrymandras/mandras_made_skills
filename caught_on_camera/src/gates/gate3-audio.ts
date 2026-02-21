/**
 * Gate 3: Audio Validation Gate
 * Validates audio matches format expectations
 * Ring Cam: ambient audio -35dB to -10dB mean volume
 * Body Cam: close-mic audio > -35dB mean volume
 * Silent clips (< -40dB) always fail and regenerate
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';

export interface Gate3Result {
  pass: boolean;
  meanVolume: number;
  action?: 'regenerate' | 'replace_audio' | 'mix_bed';
  reason?: string;
  recommendedBed?: string;
}

type BodyCamSubType = 'police_security' | 'hiker_trail' | 'dashcam' | 'helmet_action';

const BED_MAP: Record<BodyCamSubType, string> = {
  police_security: 'police_patrol_walking',
  hiker_trail: 'hiker_trail_night',
  dashcam: 'dashcam_highway',
  helmet_action: 'helmet_wind',
};

function parseMeanVolume(ffprobeOutput: string): number {
  // ffprobe volumedetect output contains: mean_volume: -23.5 dB
  const match = ffprobeOutput.match(/mean_volume:\s*([-\d.]+)\s*dB/);
  if (!match || match[1] === undefined) {
    logger.warn('Gate 3: could not parse mean_volume from ffprobe output');
    return -99.0; // treat as silent
  }
  return parseFloat(match[1]);
}

export async function runGate3(
  videoPath: string,
  format: 'ring_cam' | 'body_cam',
  subType?: string,
): Promise<Gate3Result> {
  logger.info('Gate 3: audio validation starting', { videoPath, format, subType });

  const audioPath = `/tmp/gate3_audio_${Date.now()}.wav`;

  try {
    // Extract audio from video
    try {
      execSync(
        `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${audioPath}"`,
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      // Check if audio stream actually exists
      const streamCheck = execSync(
        `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${videoPath}"`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();

      if (!streamCheck) {
        logger.warn('Gate 3: no audio stream found in video');
        return {
          pass: false,
          meanVolume: -99.0,
          action: 'regenerate',
          reason: 'no audio stream present in video',
        };
      }
    }

    if (!fs.existsSync(audioPath)) {
      logger.warn('Gate 3: audio extraction produced no file');
      return {
        pass: false,
        meanVolume: -99.0,
        action: 'regenerate',
        reason: 'audio extraction failed — no output file produced',
      };
    }

    // Run volumedetect to get mean_volume
    let volumeOutput = '';
    try {
      // volumedetect outputs to stderr
      volumeOutput = execSync(
        `ffmpeg -i "${audioPath}" -af volumedetect -f null -`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      // ffmpeg with -f null exits non-zero, stderr is in the error object
      const error = err as { stderr?: string; stdout?: string };
      volumeOutput = (error.stderr ?? '') + (error.stdout ?? '');
    }

    const meanVolume = parseMeanVolume(volumeOutput);

    logger.info('Gate 3: volume analysis result', { meanVolume, format });

    // Universal: truly silent clips always fail
    if (meanVolume < -40) {
      const reason = `meanVolume ${meanVolume.toFixed(1)}dB is below -40dB threshold — clip is silent or broken`;
      logger.warn('Gate 3: FAIL — silent clip detected', { meanVolume, reason });
      return { pass: false, meanVolume, action: 'regenerate', reason };
    }

    if (format === 'ring_cam') {
      // Ring cam: ambient audio should be -35dB to -10dB
      if (meanVolume <= -10) {
        logger.info('Gate 3: ring_cam PASS — ambient audio level acceptable', { meanVolume });
        return { pass: true, meanVolume };
      } else {
        // meanVolume > -10dB: too loud for ambient security camera audio
        const reason = `meanVolume ${meanVolume.toFixed(1)}dB exceeds ring_cam max of -10dB — audio is too loud`;
        logger.warn('Gate 3: ring_cam FAIL — audio too loud', { meanVolume, reason });
        return { pass: false, meanVolume, action: 'replace_audio', reason };
      }
    } else {
      // Body cam: close-mic, should be > -35dB
      if (meanVolume >= -35) {
        logger.info('Gate 3: body_cam PASS — close-mic audio level acceptable', { meanVolume });
        return { pass: true, meanVolume };
      } else {
        // meanVolume < -35dB: too quiet for body cam close-mic
        const recommendedBed = pickRecommendedBed(subType);
        const reason = `meanVolume ${meanVolume.toFixed(1)}dB is below body_cam minimum of -35dB — audio bed required`;
        logger.warn('Gate 3: body_cam FAIL — audio too quiet, mix_bed required', {
          meanVolume,
          reason,
          recommendedBed,
        });
        return { pass: false, meanVolume, action: 'mix_bed', reason, recommendedBed };
      }
    }
  } finally {
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  }
}

function pickRecommendedBed(subType?: string): string {
  if (subType && subType in BED_MAP) {
    return BED_MAP[subType as BodyCamSubType];
  }
  // Default fallback for unknown or missing subType
  return 'police_patrol_walking';
}
