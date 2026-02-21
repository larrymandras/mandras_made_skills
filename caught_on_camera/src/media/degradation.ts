/**
 * AI artifact masking — makes Veo output look like real security camera footage.
 *
 * Each format has its own FFmpeg filter chain tuned to match the visual/audio
 * characteristics of that camera type. The public degrade() dispatcher routes
 * to the correct function based on format.
 */
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function runFfmpeg(args: string, label: string): void {
  logger.debug(`FFmpeg [${label}]`, { args });
  try {
    execSync(`ffmpeg -y ${args}`, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stderr?: Buffer | string };
    throw new Error(`FFmpeg ${label} failed: ${e.stderr ? String(e.stderr) : String(err)}`);
  }
}

// ── Ring Cam Degradation ──────────────────────────────────────────────────────

/**
 * Apply ring-camera-style degradation to a clip:
 * - Slight barrel lens distortion (lenscorrection)
 * - Mild unsharp mask to simulate cheap CCD softness
 * - Scale to 1920×1080 (normalise source resolution)
 * - Desaturation + contrast boost (security cam colour profile)
 * - Film noise (temporal noise — allf=t)
 * - Re-encode at crf=28, audio AAC 96 kbps
 */
export async function degradeRingCam(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  logger.info('Degradation: ring_cam filter chain', { inputPath, outputPath });

  // TODO: verify lenscorrection k values produce correct barrel distortion on non-4K source
  const vf = [
    'lenscorrection=k1=-0.22:k2=0.02',
    'unsharp=luma_msize_x=3:luma_msize_y=3:luma_amount=-0.5',
    'scale=1920:1080:flags=lanczos',
    'eq=saturation=0.75:contrast=1.1',
    'noise=alls=8:allf=t',
  ].join(',');

  runFfmpeg(
    `-i "${inputPath}" -vf "${vf}" -c:v libx264 -crf 28 -preset fast -c:a aac -b:a 96k "${outputPath}"`,
    'degradeRingCam',
  );
}

// ── Body Cam Degradation ──────────────────────────────────────────────────────

/**
 * Apply body-camera-style degradation to a clip:
 * - Reduced barrel distortion (body cams are less wide than ring cams)
 * - Auto-exposure simulation via curves filter
 * - Higher temporal noise (body cams have smaller sensors)
 * - Re-encode at crf=26, audio AAC 128 kbps
 *
 * @param subType  Body cam sub-type — currently informational, reserved for
 *                 sub-type-specific tuning (e.g. dashcam uses wider lens).
 */
export async function degradeBodyCam(
  inputPath: string,
  outputPath: string,
  subType: string,
): Promise<void> {
  logger.info('Degradation: body_cam filter chain', { inputPath, outputPath, subType });

  // TODO: add dashcam-specific lens preset (wider k1 value ~= -0.20)
  // TODO: add helmet_action-specific motion blur pass
  const vf = [
    'lenscorrection=k1=-0.12:k2=0.01',
    // Auto-exposure simulation: slight S-curve via curves filter
    // Lifts shadows a touch and compresses highlights (cheap AGC effect)
    'curves=preset=none:master=\'0/0 0.2/0.25 0.8/0.75 1/1\'',
    'noise=alls=12:allf=t',
  ].join(',');

  runFfmpeg(
    `-i "${inputPath}" -vf "${vf}" -c:v libx264 -crf 26 -preset fast -c:a aac -b:a 128k "${outputPath}"`,
    `degradeBodyCam:${subType}`,
  );
}

// ── Body Cam Shake ────────────────────────────────────────────────────────────

/**
 * Add synthetic hand-held camera shake to a body-cam clip.
 * Uses sinusoidal rotation and crop offsets to simulate organic walking motion.
 * Applied when Gate 1 detects insufficient motion in body-cam footage.
 */
export async function addBodyCamShake(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  logger.info('Degradation: adding body_cam synthetic shake', { inputPath, outputPath });

  // Sinusoidal rotation at 1.8 Hz + crop drift at 0.7 Hz / 1.1 Hz on x/y axes
  // Rotation amplitude: ~0.29° — subtle but visible breathing/walking sway
  // Crop removes 20px border to hide rotation fill artefacts
  const vf = [
    "rotate='0.005*sin(2*PI*t*1.8)':fillcolor=none",
    'crop=iw-20:ih-20:10+5*sin(2*PI*t*0.7):10+3*sin(2*PI*t*1.1)',
  ].join(',');

  // TODO: ensure source resolution is high enough that the 20px crop does not
  // create visible resolution loss at 9:16 output. Scale up first if needed.
  runFfmpeg(
    `-i "${inputPath}" -vf "${vf}" -c:v libx264 -crf 26 -preset fast -c:a copy "${outputPath}"`,
    'addBodyCamShake',
  );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Dispatch to the correct degradation function based on format.
 * Returns the output path on success.
 *
 * @param inputPath   Path to the raw Veo-generated clip.
 * @param outputPath  Desired path for the degraded clip.
 * @param format      'ring_cam' or 'body_cam'.
 * @param subType     Required for body_cam; ignored for ring_cam.
 */
export async function degrade(
  inputPath: string,
  outputPath: string,
  format: string,
  subType?: string,
): Promise<string> {
  if (format === 'ring_cam') {
    await degradeRingCam(inputPath, outputPath);
  } else if (format === 'body_cam') {
    await degradeBodyCam(inputPath, outputPath, subType ?? 'police_security');
  } else {
    throw new Error(`degrade: unknown format "${format}"`);
  }
  return outputPath;
}
