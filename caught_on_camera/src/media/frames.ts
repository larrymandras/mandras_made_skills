/**
 * Frame extraction helpers — pull frames from video clips for gate analysis
 * and thumbnail generation. All frame data is returned as base64-encoded JPEG.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function tmpDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

function runFfmpeg(args: string, label: string): void {
  try {
    execSync(`ffmpeg -y ${args}`, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stderr?: Buffer | string };
    throw new Error(`FFmpeg ${label} failed: ${e.stderr ? String(e.stderr) : String(err)}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Extract `count` evenly-spaced keyframes from a video.
 * Returns an array of base64-encoded JPEG strings (no data-URI prefix).
 *
 * @param videoPath  Absolute path to the source video.
 * @param count      Number of frames to extract (evenly distributed over duration).
 */
export async function extractKeyframes(
  videoPath: string,
  count: number,
): Promise<string[]> {
  logger.info('Frames: extracting keyframes', { videoPath, count });

  const dir = tmpDir('keyframes');
  fs.mkdirSync(dir, { recursive: true });

  try {
    // Probe duration so we can compute evenly-spaced timestamps
    let duration = 0;
    try {
      const raw = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=s=,:p=0 "${videoPath}"`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
      duration = parseFloat(raw) || 0;
    } catch {
      // Fallback: use format-level duration
      try {
        const raw = execSync(
          `ffprobe -v error -show_entries format=duration -of csv=s=,:p=0 "${videoPath}"`,
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim();
        duration = parseFloat(raw) || 0;
      } catch {
        logger.warn('Frames: could not probe duration — using select=scene filter');
      }
    }

    if (duration > 0 && count > 0) {
      // Extract frames at evenly-spaced time offsets
      const interval = duration / (count + 1);
      const framePaths: string[] = [];

      for (let i = 1; i <= count; i++) {
        const t = (interval * i).toFixed(3);
        const outFile = path.join(dir, `frame_${String(i).padStart(4, '0')}.jpg`);
        try {
          runFfmpeg(
            `-ss ${t} -i "${videoPath}" -frames:v 1 -q:v 2 "${outFile}"`,
            `extractKeyframes:frame${i}`,
          );
          if (fs.existsSync(outFile)) framePaths.push(outFile);
        } catch {
          logger.warn('Frames: could not extract frame at time', { t });
        }
      }

      logger.info('Frames: extracted keyframes', { count: framePaths.length });
      return framesToBase64(framePaths);
    }

    // Fallback: fps-based extraction (1 frame/s, take first `count`)
    logger.warn('Frames: falling back to 1fps extraction', { count });
    runFfmpeg(
      `-i "${videoPath}" -vf "fps=1" -q:v 2 "${dir}/frame_%04d.jpg"`,
      'extractKeyframes:fps1',
    );

    const all = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .slice(0, count)
      .map((f) => path.join(dir, f));

    return framesToBase64(all);
  } finally {
    // Clean up frame dir
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

/**
 * Extract a single frame at the given time offset.
 * Returns a base64-encoded JPEG string (no data-URI prefix).
 *
 * @param videoPath    Absolute path to the source video.
 * @param timeSeconds  Seek position in seconds.
 */
export async function extractFrameAtTime(
  videoPath: string,
  timeSeconds: number,
): Promise<string> {
  logger.info('Frames: extracting single frame', { videoPath, timeSeconds });

  const outPath = path.join(os.tmpdir(), `frame_at_${Date.now()}.jpg`);

  try {
    runFfmpeg(
      `-ss ${timeSeconds.toFixed(3)} -i "${videoPath}" -frames:v 1 -q:v 2 "${outPath}"`,
      'extractFrameAtTime',
    );

    if (!fs.existsSync(outPath)) {
      throw new Error(`extractFrameAtTime: output frame not produced at t=${timeSeconds}`);
    }

    const b64 = fs.readFileSync(outPath).toString('base64');
    return b64;
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
}

/**
 * Read an array of JPEG frame files from disk and return them as base64 strings.
 * Frames that cannot be read are silently skipped (warning logged).
 *
 * @param framePaths  Absolute paths to JPEG frame files.
 */
export async function framesToBase64(framePaths: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const fp of framePaths) {
    try {
      results.push(fs.readFileSync(fp).toString('base64'));
    } catch {
      logger.warn('Frames: could not read frame file', { path: fp });
    }
  }
  return results;
}
