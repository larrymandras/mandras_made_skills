/**
 * Core FFmpeg operations — clip concatenation, frame extraction, audio work,
 * metadata probing, cropping, motion analysis, and audio-bed mixing.
 *
 * All functions throw on non-zero FFmpeg/FFprobe exit unless otherwise noted.
 * Callers are responsible for temp-file cleanup where paths are returned.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function runFfmpeg(args: string, label: string): void {
  logger.debug(`FFmpeg [${label}]`, { args });
  try {
    execSync(`ffmpeg -y ${args}`, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = e.stderr ? String(e.stderr) : '';
    throw new Error(`FFmpeg ${label} failed: ${stderr || String(err)}`);
  }
}

function runFfprobe(args: string, label: string): string {
  logger.debug(`FFprobe [${label}]`, { args });
  try {
    return execSync(`ffprobe ${args}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
    // ffprobe writes output to stderr for some commands; capture both
    return ((e.stdout ? String(e.stdout) : '') + (e.stderr ? String(e.stderr) : '')).trim();
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Concatenate multiple video clips into a single output file using the
 * concat demuxer. All clips must share the same codec, resolution, and fps.
 */
export async function concatenateClips(
  clipPaths: string[],
  outputPath: string,
): Promise<void> {
  logger.info('FFmpeg: concatenating clips', { count: clipPaths.length, outputPath });

  if (clipPaths.length === 0) throw new Error('concatenateClips: no clips provided');

  // Write ffmpeg concat list file
  const listPath = path.join(os.tmpdir(), `concat_${Date.now()}.txt`);
  const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listPath, listContent, 'utf-8');

  try {
    runFfmpeg(
      `-f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`,
      'concatenateClips',
    );
  } finally {
    if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
  }

  logger.info('FFmpeg: concatenation complete', { outputPath });
}

/**
 * Extract frames from a video at the given interval (in seconds).
 * Returns an array of absolute paths to the extracted JPEG frames.
 */
export async function extractFrames(
  videoPath: string,
  intervalSeconds: number,
  outputDir: string,
): Promise<string[]> {
  logger.info('FFmpeg: extracting frames', { videoPath, intervalSeconds, outputDir });
  fs.mkdirSync(outputDir, { recursive: true });

  // TODO: handle very short clips where intervalSeconds > duration
  const fps = 1 / intervalSeconds;
  runFfmpeg(
    `-i "${videoPath}" -vf "fps=${fps}" "${outputDir}/frame_%04d.jpg"`,
    'extractFrames',
  );

  const frames = fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => path.join(outputDir, f));

  logger.info('FFmpeg: frame extraction complete', { frameCount: frames.length });
  return frames;
}

/**
 * Extract the audio track from a video and write it to outputPath as AAC.
 */
export async function extractAudio(
  videoPath: string,
  outputPath: string,
): Promise<void> {
  logger.info('FFmpeg: extracting audio', { videoPath, outputPath });
  // TODO: detect whether audio stream exists before running; return early if absent
  runFfmpeg(
    `-i "${videoPath}" -vn -acodec aac -b:a 128k "${outputPath}"`,
    'extractAudio',
  );
}

/**
 * Probe a video file and return its core metadata.
 * meanVolume is obtained via a separate volumedetect pass.
 */
export async function getVideoMetadata(videoPath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
  meanVolume: number;
}> {
  logger.info('FFmpeg: probing metadata', { videoPath });

  // Stream-level video info
  const streamOut = runFfprobe(
    `-v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,duration -of csv=s=,:p=0 "${videoPath}"`,
    'getVideoMetadata:streams',
  );

  const [widthStr, heightStr, fpsStr, durationStr] = streamOut.split(',');
  const width = parseInt(widthStr ?? '0', 10);
  const height = parseInt(heightStr ?? '0', 10);
  const duration = parseFloat(durationStr ?? '0');

  // r_frame_rate is returned as "N/D"
  let fps = 0;
  if (fpsStr) {
    const [num, den] = fpsStr.split('/');
    fps = den ? parseFloat(num ?? '0') / parseFloat(den) : parseFloat(num ?? '0');
  }

  // Volume detect pass
  let volumeOutput = '';
  try {
    execSync(`ffmpeg -i "${videoPath}" -af volumedetect -f null - 2>&1`, { encoding: 'utf-8' });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string };
    volumeOutput = (e.stderr ?? '') + (e.stdout ?? '');
  }
  const volMatch = volumeOutput.match(/mean_volume:\s*([-\d.]+)\s*dB/);
  const meanVolume = volMatch?.[1] ? parseFloat(volMatch[1]) : -99;

  const meta = { duration, width, height, fps, meanVolume };
  logger.info('FFmpeg: metadata probed', meta);
  return meta;
}

/**
 * Center-crop a 16:9 video to 9:16 vertical aspect ratio.
 * When cropSafe is false the function is a no-op (copies source to output).
 */
export async function cropToVertical(
  inputPath: string,
  outputPath: string,
  cropSafe: boolean,
): Promise<void> {
  if (!cropSafe) {
    logger.info('FFmpeg: cropSafe=false — skipping vertical crop, copying source');
    runFfmpeg(`-i "${inputPath}" -c copy "${outputPath}"`, 'cropToVertical:copy');
    return;
  }

  logger.info('FFmpeg: center-cropping 16:9 → 9:16', { inputPath, outputPath });
  // For a 1920×1080 source: crop to 608×1080 centered → scale to 1080×1920
  // For arbitrary input, compute crop width as ih*(9/16) centered on iw
  runFfmpeg(
    `-i "${inputPath}" -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}"`,
    'cropToVertical',
  );
}

/**
 * Analyse motion in a video using vidstabdetect.
 * Returns avgMotion and maxMotion computed from the generated .trf file.
 */
export async function analyzeMotion(
  videoPath: string,
): Promise<{ avgMotion: number; maxMotion: number }> {
  logger.info('FFmpeg: analyzing motion', { videoPath });

  const trfPath = `/tmp/motion_${Date.now()}.trf`;

  try {
    // ffmpeg exits non-zero with -f null — swallow the error and check trf
    try {
      execSync(
        `ffmpeg -y -i "${videoPath}" -vf "vidstabdetect=result=${trfPath}:shakiness=10:accuracy=15" -f null -`,
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      // expected non-zero exit from -f null; continue
    }

    if (!fs.existsSync(trfPath)) {
      logger.warn('FFmpeg: motion.trf not produced — returning zero motion');
      return { avgMotion: 0, maxMotion: 0 };
    }

    const content = fs.readFileSync(trfPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    const magnitudes: number[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const dx = parseFloat(parts[1] ?? '0');
        const dy = parseFloat(parts[2] ?? '0');
        if (!isNaN(dx) && !isNaN(dy)) {
          magnitudes.push(Math.sqrt(dx * dx + dy * dy));
        }
      }
    }

    if (magnitudes.length === 0) return { avgMotion: 0, maxMotion: 0 };

    const avgMotion = magnitudes.reduce((s, v) => s + v, 0) / magnitudes.length;
    const maxMotion = Math.max(...magnitudes);

    logger.info('FFmpeg: motion analysis result', { avgMotion, maxMotion });
    return { avgMotion, maxMotion };
  } finally {
    if (fs.existsSync(trfPath)) fs.unlinkSync(trfPath);
  }
}

/**
 * Mix an audio bed under the primary video audio.
 * The bed is attenuated to bedVolumeDb dB (relative) and amixed with the
 * original track. Target is to keep the bed at -15 dB under Veo audio.
 */
export async function mixAudioBed(
  videoPath: string,
  bedPath: string,
  bedVolumeDb: number,
  outputPath: string,
): Promise<void> {
  logger.info('FFmpeg: mixing audio bed', { bedPath, bedVolumeDb, outputPath });

  // TODO: handle clips shorter than the bed (loop bed with -stream_loop -1)
  runFfmpeg(
    `-i "${videoPath}" -i "${bedPath}" ` +
    `-filter_complex "[1:a]volume=${bedVolumeDb}dB[bed];[0:a][bed]amix=inputs=2:duration=first:dropout_transition=2[out]" ` +
    `-map 0:v -map "[out]" -c:v copy -c:a aac -b:a 128k "${outputPath}"`,
    'mixAudioBed',
  );
}

/**
 * Replace a video's audio track entirely with the supplied audio file.
 * The audio is re-encoded to AAC; the video stream is stream-copied.
 */
export async function replaceAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  logger.info('FFmpeg: replacing audio track', { videoPath, audioPath, outputPath });

  runFfmpeg(
    `-i "${videoPath}" -i "${audioPath}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -shortest "${outputPath}"`,
    'replaceAudio',
  );
}
