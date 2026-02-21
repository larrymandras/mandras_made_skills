/**
 * Gate 5: Crop Safety Gate
 * Validates that key action occurs in center 56.25% of frame (safe for 9:16 crop)
 * Center crop zone: for 1920px wide source → center 1080px (420px margins each side)
 * If action is off-center: flag as '16:9 only' (don't reject — publish to YouTube only)
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { analyzeFrames } from '../ai/claude.js';

export interface Gate5Result {
  pass: boolean;
  cropSafe: boolean;
  reason?: string;
  recommendation?: 'all_platforms' | 'youtube_only';
}

// 9:16 crop zone: center 56.25% of width (1080/1920 = 0.5625)
// Safe zone = middle 56.25% → outer margins are (100% - 56.25%) / 2 = 21.875% each side
const OUTER_MARGIN_PERCENT = 21.875;
const OFF_CENTER_THRESHOLD = 0.4; // >40% of action in outer zones triggers youtube_only

function extractFramesEvery2s(videoPath: string, outputDir: string): string[] {
  fs.mkdirSync(outputDir, { recursive: true });

  // Extract one frame every 2 seconds (fps=0.5)
  execSync(
    `ffmpeg -i "${videoPath}" -vf "fps=0.5" "${outputDir}/frame_%04d.jpg"`,
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const frames = fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => path.join(outputDir, f));

  return frames;
}

function frameToBase64(framePath: string): string {
  return fs.readFileSync(framePath).toString('base64');
}

export async function runGate5(
  videoPath: string,
  format: 'ring_cam' | 'body_cam',
): Promise<Gate5Result> {
  logger.info('Gate 5: crop safety check starting', { videoPath, format });

  const frameDir = `/tmp/gate5_frames_${Date.now()}`;

  try {
    const framePaths = extractFramesEvery2s(videoPath, frameDir);

    if (framePaths.length === 0) {
      logger.warn('Gate 5: no frames extracted — defaulting to crop-safe');
      return { pass: true, cropSafe: true, recommendation: 'all_platforms' };
    }

    const base64Frames = framePaths.map(frameToBase64);

    const formatContext =
      format === 'ring_cam'
        ? 'Ring cam (static security camera — subjects should appear in the center third of the frame)'
        : 'Body cam (first-person POV — wearer is walking so subjects ahead should be roughly centered)';

    const analysisPrompt = `You are analyzing video frames for crop safety. The video will be cropped to 9:16 vertical format.

The SAFE ZONE is the center 56.25% of the frame width. The OUTER ZONES are the left and right 21.875% margins — these get cropped off in vertical format.

Format context: ${formatContext}

For each frame, identify where the KEY ACTION or MAIN SUBJECT is located:
- Is the primary subject/action in the CENTER ZONE (safe) or OUTER ZONES (will be cropped)?

Analyze all ${base64Frames.length} frames and respond with this JSON:
{
  "framesAnalyzed": <count>,
  "framesWithOffCenterAction": <count>,
  "offCenterPercent": <0.0 to 1.0>,
  "summary": "<brief description>"
}

Count a frame as "off-center" if more than half the key action/subject is in the outer 21.875% on either side.
For body cam footage, subjects ahead of the wearer are usually centered — only flag if clearly off to one side.
For ring cam footage, flag if the main subject (person/animal/anomaly) is near the edge.`;

    const response = await analyzeFrames(base64Frames, analysisPrompt);
    logger.info('Gate 5: Claude crop analysis received', { responseLength: response.length });

    let offCenterPercent = 0;
    let framesWithOffCenterAction = 0;
    let framesAnalyzed = framePaths.length;

    try {
      const jsonMatch = response.match(/\{[\s\S]*"framesAnalyzed"[\s\S]*\}/);
      if (jsonMatch?.[0]) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          framesAnalyzed?: number;
          framesWithOffCenterAction?: number;
          offCenterPercent?: number;
        };
        framesAnalyzed = parsed.framesAnalyzed ?? framesAnalyzed;
        framesWithOffCenterAction = parsed.framesWithOffCenterAction ?? 0;
        offCenterPercent = parsed.offCenterPercent ?? 0;
      }
    } catch {
      logger.warn('Gate 5: could not parse structured response, falling back to text analysis');
      // Simple text fallback: if response mentions "off-center" or "edge" multiple times, flag it
      const offCenterMentions = (response.toLowerCase().match(/off.center|outer zone|edge|cropped/g) ?? []).length;
      offCenterPercent = offCenterMentions > 3 ? 0.5 : 0;
    }

    logger.info('Gate 5: crop analysis results', {
      framesAnalyzed,
      framesWithOffCenterAction,
      offCenterPercent,
    });

    const cropSafe = offCenterPercent <= OFF_CENTER_THRESHOLD;

    if (cropSafe) {
      logger.info('Gate 5: PASS — action is crop-safe for 9:16', { offCenterPercent });
      return {
        pass: true,
        cropSafe: true,
        recommendation: 'all_platforms',
      };
    } else {
      const reason = `${(offCenterPercent * 100).toFixed(1)}% of frames have off-center action — key content may be cropped in 9:16 format`;
      logger.warn('Gate 5: action is off-center — restricting to YouTube (16:9) only', {
        offCenterPercent,
        reason,
      });
      return {
        pass: true, // Gate 5 always passes — it just changes the platform recommendation
        cropSafe: false,
        reason,
        recommendation: 'youtube_only',
      };
    }
  } finally {
    if (fs.existsSync(frameDir)) {
      fs.rmSync(frameDir, { recursive: true, force: true });
    }
  }
}
