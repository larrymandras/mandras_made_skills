/**
 * Gate 7: AI Disclosure Watermark Gate (HARD FAIL if missing)
 * Verifies that "AI GENERATED" watermark is burned into the video
 * This is the final gate — disclosure must survive re-uploads
 * Checks bottom-right corner of frame for watermark text
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';
import { analyzeFrames } from '../ai/claude.js';

export interface Gate7Result {
  pass: boolean;
  hardFail: boolean;
  watermarkDetected: boolean;
  watermarkText?: string;
}

function extractLastFrame(videoPath: string, outputPath: string): boolean {
  try {
    // Seek to last 3 seconds, grab final frame
    execSync(
      `ffmpeg -sseof -3 -i "${videoPath}" -update 1 -q:v 1 "${outputPath}"`,
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return fs.existsSync(outputPath);
  } catch {
    // Fallback: grab from near the end using duration
    try {
      // Get duration first
      const duration = execSync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
        { encoding: 'utf-8' },
      ).trim();
      const durationSec = parseFloat(duration);
      const seekTo = Math.max(0, durationSec - 1);

      execSync(
        `ffmpeg -ss ${seekTo} -i "${videoPath}" -vframes 1 "${outputPath}"`,
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return fs.existsSync(outputPath);
    } catch {
      return false;
    }
  }
}

export async function runGate7(videoPath: string): Promise<Gate7Result> {
  logger.info('Gate 7: AI disclosure watermark check starting', { videoPath });

  const lastFramePath = `/tmp/gate7_last_${Date.now()}.jpg`;

  try {
    const extracted = extractLastFrame(videoPath, lastFramePath);

    if (!extracted) {
      logger.error('Gate 7: HARD FAIL — could not extract last frame for watermark check');
      return {
        pass: false,
        hardFail: true,
        watermarkDetected: false,
        watermarkText: undefined,
      };
    }

    const base64Frame = fs.readFileSync(lastFramePath).toString('base64');

    const watermarkPrompt = `You are performing a compliance check on a video frame.

Look carefully at the BOTTOM-RIGHT CORNER of this image (roughly the last 15-20% of width and last 15-20% of height).

Search for any disclosure text or watermark that says:
- "AI GENERATED"
- "AI Generated"
- "AI" (as a standalone label)
- Any similar AI disclosure text

IMPORTANT: The watermark may be semi-transparent at 10-15% opacity, very small text, or faint. Look very carefully even for subtle text overlays.

Respond with this exact JSON format:
{
  "watermarkDetected": <true|false>,
  "watermarkText": "<exact text you see, or null if not found>",
  "confidence": "<high|medium|low>",
  "location": "<description of where in the frame you see it, or 'not found'>"
}`;

    const response = await analyzeFrames([base64Frame], watermarkPrompt);
    logger.info('Gate 7: Claude watermark analysis received', { responseLength: response.length });

    let watermarkDetected = false;
    let watermarkText: string | undefined;

    try {
      const jsonMatch = response.match(/\{[\s\S]*"watermarkDetected"[\s\S]*\}/);
      if (jsonMatch?.[0]) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          watermarkDetected?: boolean;
          watermarkText?: string | null;
          confidence?: string;
          location?: string;
        };
        watermarkDetected = parsed.watermarkDetected ?? false;
        watermarkText = parsed.watermarkText ?? undefined;
      }
    } catch {
      logger.warn('Gate 7: could not parse structured JSON — falling back to text analysis');
      const lower = response.toLowerCase();
      watermarkDetected =
        (lower.includes('ai generated') || lower.includes('"ai"') || lower.includes('watermark')) &&
        (lower.includes('visible') || lower.includes('detected') || lower.includes('present') || lower.includes('true'));

      // Try to extract watermark text from response
      const textMatch = response.match(/"AI\s*GENERATED"|"AI Generated"|"AI"/i);
      if (textMatch) {
        watermarkText = textMatch[0].replace(/"/g, '');
      }
    }

    logger.info('Gate 7: watermark detection result', { watermarkDetected, watermarkText });

    if (watermarkDetected) {
      logger.info('Gate 7: PASS — AI disclosure watermark detected', { watermarkText });
      return {
        pass: true,
        hardFail: false,
        watermarkDetected: true,
        watermarkText,
      };
    } else {
      logger.error(
        'Gate 7: HARD FAIL — AI disclosure watermark NOT detected in bottom-right corner',
        { videoPath },
      );
      return {
        pass: false,
        hardFail: true,
        watermarkDetected: false,
        watermarkText: undefined,
      };
    }
  } finally {
    if (fs.existsSync(lastFramePath)) {
      fs.unlinkSync(lastFramePath);
    }
  }
}
