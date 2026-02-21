/**
 * Gate 6: Overlay Quality Gate
 * Validates that the UI overlay was applied correctly and looks authentic
 * Checks: overlay is present, timestamp is readable, format matches (ring cam vs body cam)
 * Uses Claude vision to verify overlay quality on sample frames
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';
import { analyzeFrames } from '../ai/claude.js';

export interface Gate6Result {
  pass: boolean;
  overlayDetected: boolean;
  timestampReadable: boolean;
  formatCorrect: boolean;
  reason?: string;
}

function extractFrame(videoPath: string, outputPath: string, position: 'first' | 'last'): boolean {
  try {
    if (position === 'first') {
      execSync(
        `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,0)" -vframes 1 "${outputPath}"`,
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } else {
      // Extract last frame by seeking to end
      execSync(
        `ffmpeg -sseof -3 -i "${videoPath}" -update 1 -q:v 1 "${outputPath}"`,
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
    }
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

function frameToBase64(framePath: string): string {
  return fs.readFileSync(framePath).toString('base64');
}

export async function runGate6(
  videoPath: string,
  format: 'ring_cam' | 'body_cam',
): Promise<Gate6Result> {
  logger.info('Gate 6: overlay quality check starting', { videoPath, format });

  const firstFramePath = `/tmp/gate6_first_${Date.now()}.jpg`;
  const lastFramePath = `/tmp/gate6_last_${Date.now()}.jpg`;
  const extractedPaths: string[] = [];

  try {
    const firstExtracted = extractFrame(videoPath, firstFramePath, 'first');
    const lastExtracted = extractFrame(videoPath, lastFramePath, 'last');

    if (firstExtracted) extractedPaths.push(firstFramePath);
    if (lastExtracted) extractedPaths.push(lastFramePath);

    if (extractedPaths.length === 0) {
      logger.error('Gate 6: failed to extract any frames from video');
      return {
        pass: false,
        overlayDetected: false,
        timestampReadable: false,
        formatCorrect: false,
        reason: 'could not extract frames from video for overlay inspection',
      };
    }

    const base64Frames = extractedPaths.map(frameToBase64);

    const formatExpectation =
      format === 'ring_cam'
        ? 'doorbell/porch camera UI (e.g., Ring, Nest, Arlo style: black bars, camera name, date/time stamp in corner, motion detection indicator)'
        : 'first-person body cam or dash cam UI (e.g., Axon/Taser body cam style: officer ID, date/time stamp, recording indicator, battery/GPS info)';

    const overlayPrompt = `You are inspecting security camera video frames for UI overlay quality control.

Examine ${base64Frames.length} frame(s) carefully and answer these three questions:

1. OVERLAY PRESENT: Is there a security camera UI overlay visible? Look for: timestamp/date display, recording indicator (REC dot), camera name/ID, status bars, or any HUD elements typical of surveillance footage.

2. TIMESTAMP READABLE: Is there a date and/or time display that is legible (even if partially visible)?

3. FORMAT MATCH: Does the overlay style match the expected format: ${formatExpectation}?

Respond with this exact JSON format:
{
  "overlayDetected": <true|false>,
  "timestampReadable": <true|false>,
  "formatCorrect": <true|false>,
  "details": "<brief description of what you see>"
}

Be strict: if there is no visible UI overlay at all, set overlayDetected to false. If the overlay is present but the timestamp is too small/blurry to read, set timestampReadable to false. If the overlay style clearly doesn't match the expected format, set formatCorrect to false.`;

    const response = await analyzeFrames(base64Frames, overlayPrompt);
    logger.info('Gate 6: Claude overlay analysis received', { responseLength: response.length });

    let overlayDetected = false;
    let timestampReadable = false;
    let formatCorrect = false;
    let details = '';

    try {
      const jsonMatch = response.match(/\{[\s\S]*"overlayDetected"[\s\S]*\}/);
      if (jsonMatch?.[0]) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          overlayDetected?: boolean;
          timestampReadable?: boolean;
          formatCorrect?: boolean;
          details?: string;
        };
        overlayDetected = parsed.overlayDetected ?? false;
        timestampReadable = parsed.timestampReadable ?? false;
        formatCorrect = parsed.formatCorrect ?? false;
        details = parsed.details ?? '';
      }
    } catch {
      logger.warn('Gate 6: could not parse structured JSON response — falling back to text analysis');
      const lower = response.toLowerCase();
      overlayDetected =
        lower.includes('overlay') && (lower.includes('visible') || lower.includes('present') || lower.includes('yes'));
      timestampReadable =
        lower.includes('timestamp') && (lower.includes('readable') || lower.includes('visible') || lower.includes('legible'));
      formatCorrect =
        lower.includes('match') || lower.includes('correct') || lower.includes('appropriate');
    }

    logger.info('Gate 6: overlay analysis results', {
      overlayDetected,
      timestampReadable,
      formatCorrect,
      details,
    });

    const pass = overlayDetected && timestampReadable && formatCorrect;

    if (pass) {
      logger.info('Gate 6: PASS — overlay is present, readable, and format-correct');
      return { pass: true, overlayDetected, timestampReadable, formatCorrect };
    }

    const failReasons: string[] = [];
    if (!overlayDetected) failReasons.push('no UI overlay detected');
    if (!timestampReadable) failReasons.push('timestamp not readable');
    if (!formatCorrect) failReasons.push(`overlay does not match ${format} format`);

    const reason = failReasons.join('; ');
    logger.warn('Gate 6: FAIL — overlay quality check failed', { reason, details });
    return { pass: false, overlayDetected, timestampReadable, formatCorrect, reason };
  } finally {
    for (const p of extractedPaths) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
}
