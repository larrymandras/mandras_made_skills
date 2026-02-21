/**
 * Video assembly — concatenates produced scene clips and builds multi-format outputs.
 *
 * assembleCompilation: fetch N scene clips from DB, concatenate, apply shared
 * overlay, burn disclosure watermark.
 *
 * buildMultiFormat: from a finished master, produce both 16:9 and 9:16 variants
 * when the clip passes the crop-safe gate.
 */
import * as fs from 'fs';
import * as path from 'path';
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import { concatenateClips, cropToVertical } from '../media/ffmpeg.js';
import { burnDisclosure, applyOverlay } from '../media/overlay.js';
import { dbSelect } from '../db/client.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AssembledCompilation {
  videoPath: string;
  duration: number;
}

export interface MultiFormatResult {
  master16x9: string;
  vertical9x16?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempPath(label: string, ext = 'mp4'): string {
  const dir = env.TEMP_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${label}_${Date.now()}.${ext}`);
}

/** Probe video duration using ffprobe */
async function probeDuration(videoPath: string): Promise<number> {
  const { execSync } = await import('child_process');
  try {
    const raw = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=s=,:p=0 "${videoPath}"`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    return parseFloat(raw) || 0;
  } catch {
    logger.warn('Assembler: could not probe duration', { videoPath });
    return 0;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Assemble a compilation from multiple scene IDs.
 *
 * Steps:
 * 1. Fetch scene records from DB to get their local/CDN video paths.
 * 2. Concatenate clips with ffmpeg concat demuxer.
 * 3. Apply a shared compilation overlay (format-specific header).
 * 4. Burn the AI-generated disclosure watermark.
 *
 * @param sceneIds   Array of scene record IDs to include in the compilation.
 * @param theme      Thematic label for the compilation (used in overlay).
 * @param format     'ring_cam' | 'body_cam' — determines overlay template.
 */
export async function assembleCompilation(
  sceneIds: string[],
  theme: string,
  format: string,
): Promise<AssembledCompilation> {
  logger.info('Assembler: assembling compilation', {
    sceneCount: sceneIds.length,
    theme,
    format,
  });

  if (sceneIds.length === 0) {
    throw new Error('assembleCompilation: no scene IDs provided');
  }

  // Fetch scene records from DB
  const scenePaths: string[] = [];
  for (const sceneId of sceneIds) {
    const rows = await dbSelect('scenes', { id: sceneId });
    const row = rows[0];
    if (!row) {
      logger.warn('Assembler: scene not found in DB — skipping', { sceneId });
      continue;
    }
    // Prefer local overlaid path; fall back to cloudinary URL
    // TODO: implement download-from-CDN if local file is absent
    const videoPath = String(row['overlaid_video_url'] ?? row['cloudinary_url'] ?? '');
    if (!videoPath || !fs.existsSync(videoPath)) {
      logger.warn('Assembler: scene video path not found locally — skipping', { sceneId, videoPath });
      continue;
    }
    scenePaths.push(videoPath);
  }

  if (scenePaths.length === 0) {
    throw new Error('assembleCompilation: no local video files found for provided scene IDs');
  }

  // Step 1: Concatenate clips
  const concatPath = tempPath(`concat_${format}`);
  await concatenateClips(scenePaths, concatPath);

  // Step 2: Apply shared overlay
  // Use a generic compilation template
  const overlayTemplatePath = path.join(env.OVERLAYS_PATH, format, 'compilation.png');
  const overlaidPath = tempPath(`compilation_overlaid_${format}`);

  const overlayConfig =
    format === 'ring_cam'
      ? {
          cameraName:   theme,
          brand:        'HomeCam' as const,
          timestamp:    new Date(),
          templatePath: overlayTemplatePath,
        }
      : {
          unitId:       'COMPILATION',
          subType:      'police_security',
          timestamp:    new Date(),
          templatePath: overlayTemplatePath,
        };

  await applyOverlay(concatPath, overlaidPath, format, overlayConfig);

  // Step 3: Burn disclosure watermark
  const finalPath = tempPath(`compilation_final_${format}`);
  await burnDisclosure(overlaidPath, finalPath);

  // Probe final duration
  const duration = await probeDuration(finalPath);

  logger.info('Assembler: compilation complete', { finalPath, duration });
  return { videoPath: finalPath, duration };
}

/**
 * Build both 16:9 (master) and 9:16 (vertical) variants from a finished video.
 *
 * When cropSafe is false only the 16:9 master is returned, as center-cropping
 * the clip would cut off important content.
 *
 * @param videoPath  Absolute path to the fully-produced master clip.
 * @param cropSafe   Whether the clip passed the crop-safe gate.
 */
export async function buildMultiFormat(
  videoPath: string,
  cropSafe: boolean,
): Promise<MultiFormatResult> {
  logger.info('Assembler: building multi-format outputs', { videoPath, cropSafe });

  // The 16:9 master is the source clip as-is (already at 1920×1080 post-degradation)
  const master16x9 = videoPath;

  if (!cropSafe) {
    logger.info('Assembler: cropSafe=false — returning 16:9 master only');
    return { master16x9 };
  }

  // Produce 9:16 vertical crop for Shorts / Reels / TikTok
  const vertical9x16 = tempPath('vertical_9x16');
  await cropToVertical(videoPath, vertical9x16, true);

  logger.info('Assembler: multi-format complete', { master16x9, vertical9x16 });
  return { master16x9, vertical9x16 };
}
