/**
 * Format-switching Producer Agent.
 *
 * Orchestrates the full per-clip production pipeline:
 *   prompt sanitization → Veo generation → degradation → gate checks
 *   → overlay → disclosure → optional crop → Cloudinary upload.
 *
 * Retries failed gate checks up to RETRY_POLICY.maxRetries times.
 * Gate 1 body_cam failures trigger shake injection before re-running.
 * Gate 3 body_cam failures trigger audio-bed mixing before re-running.
 */
import * as fs from 'fs';
import * as path from 'path';
import { env, RETRY_POLICY } from '../config.js';
import { logger } from '../utils/logger.js';
import { generateClip } from '../ai/veo.js';
import { degrade, addBodyCamShake } from '../media/degradation.js';
import { applyOverlay, burnDisclosure } from '../media/overlay.js';
import { cropToVertical, mixAudioBed, replaceAudio } from '../media/ffmpeg.js';
import { extractKeyframes } from '../media/frames.js';
import { sanitizePrompt, runGate4 } from '../gates/gate4-policy.js';
import { runGate1 } from '../gates/gate1-motion.js';
import { runGate2 } from '../gates/gate2-face.js';
import { runGate3 } from '../gates/gate3-audio.js';
import { trackCost } from '../monitoring/costs.js';
import type { RingCamIdea, BodyCamIdea } from '../db/ideas.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProducedScene {
  sceneId: string;
  videoPath: string;
  cost: number;
  cropSafe: boolean;
}

// ── Veo Prompt Templates ──────────────────────────────────────────────────────
// (PRD Section 7)

function buildRingCamPrompt(idea: RingCamIdea): string {
  return (
    `Ring doorbell camera footage. ${idea.camera_position}. ` +
    `${idea.time_of_day} lighting. Static fixed camera. Slight fisheye distortion. ` +
    `Scene: ${idea.scenario} ` +
    `${idea.audio_notes ? `Audio cues: ${idea.audio_notes}.` : ''} ` +
    `Authentic-looking security camera footage. No camera movement.`
  ).trim();
}

function buildBodyCamPrompt(idea: BodyCamIdea): string {
  const subTypeContext: Record<string, string> = {
    police_security: 'Security patrol person walking slowly on patrol.',
    hiker_trail:     'Trail hiker moving through outdoor terrain.',
    dashcam:         'Dashboard-mounted camera in a moving vehicle.',
    helmet_action:   'Helmet-mounted camera during active sport.',
  };

  return (
    `First-person body camera POV footage. ${subTypeContext[idea.cam_sub_type] ?? ''} ` +
    `${idea.time_of_day} lighting. Handheld camera motion with natural sway. ` +
    `Scene: ${idea.scenario} ` +
    `${idea.movement_notes ? `Camera motion: ${idea.movement_notes}.` : ''} ` +
    `${idea.audio_notes ? `Audio: ${idea.audio_notes}.` : ''} ` +
    `Authentic body camera found footage style.`
  ).trim();
}

// ── Cloudinary upload ─────────────────────────────────────────────────────────

async function uploadToCloudinary(localPath: string, publicId: string): Promise<string> {
  // TODO: implement Cloudinary upload using the cloudinary Node SDK:
  //   import { v2 as cloudinary } from 'cloudinary';
  //   cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, ... });
  //   const result = await cloudinary.uploader.upload(localPath, {
  //     resource_type: 'video', public_id: publicId,
  //     folder: 'caught_on_camera',
  //   });
  //   return result.secure_url;
  logger.warn('Cloudinary upload not implemented — returning placeholder URL', { publicId });
  return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/video/upload/${publicId}.mp4`;
}

// ── Temp-file management ──────────────────────────────────────────────────────

function tempPath(label: string, ext = 'mp4'): string {
  const dir = env.TEMP_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${label}_${Date.now()}.${ext}`);
}

// ── Overlay config builders ───────────────────────────────────────────────────

function buildRingCamOverlayConfig(idea: RingCamIdea, overlayTemplatePath: string) {
  const brands = ['HomeCam', 'DoorView', 'PorchGuard'] as const;
  const brand = brands[Math.floor(Math.random() * brands.length)]!;
  return {
    cameraName:   idea.title.slice(0, 20),
    brand,
    timestamp:    new Date(),
    templatePath: overlayTemplatePath,
  };
}

function buildBodyCamOverlayConfig(idea: BodyCamIdea, overlayTemplatePath: string) {
  const unitNumber = Math.floor(Math.random() * 900 + 100);
  return {
    unitId:       `UNIT-${unitNumber}`,
    subType:      idea.cam_sub_type,
    timestamp:    new Date(),
    templatePath: overlayTemplatePath,
    showGps:      idea.cam_sub_type === 'police_security',
    showSpeed:    idea.cam_sub_type === 'dashcam',
    speedMph:     idea.cam_sub_type === 'dashcam' ? Math.floor(Math.random() * 45 + 25) : undefined,
  };
}

// ── Audio bed picker ──────────────────────────────────────────────────────────

function pickAudioBed(subType: string, bedDir: string): string | null {
  const bedMap: Record<string, string> = {
    police_security: 'police_patrol_walking.mp3',
    hiker_trail:     'hiker_trail_night.mp3',
    dashcam:         'dashcam_highway.mp3',
    helmet_action:   'helmet_wind.mp3',
  };
  const filename = bedMap[subType] ?? 'police_patrol_walking.mp3';
  const full = path.join(bedDir, filename);
  if (!fs.existsSync(full)) {
    logger.warn('Producer: audio bed file not found', { path: full });
    return null;
  }
  return full;
}

// ── Main production function ───────────────────────────────────────────────────

/**
 * Produce a single video from an idea record.
 *
 * @param idea    Ring cam or body cam idea record.
 * @param format  'ring_cam' | 'body_cam'
 * @returns       Scene record with local video path, cost, and crop-safe flag.
 */
export async function produceVideo(
  idea: RingCamIdea | BodyCamIdea,
  format: 'ring_cam' | 'body_cam',
): Promise<ProducedScene> {
  logger.info('Producer: starting video production', { ideaId: idea.id, format });

  // ── Step 1: Sanitize prompt (Gate 4 Stage A) ─────────────────────────────
  const rawPrompt = format === 'ring_cam'
    ? buildRingCamPrompt(idea as RingCamIdea)
    : buildBodyCamPrompt(idea as BodyCamIdea);

  const sanitized = sanitizePrompt(rawPrompt);
  if (!sanitized.pass) {
    throw new Error(
      `Producer: prompt contains blocked words and cannot be produced: ` +
      sanitized.blockedWords.join(', '),
    );
  }
  const prompt = sanitized.sanitized!;

  logger.info('Producer: prompt sanitized', { rewrites: sanitized.rewrites.length });

  // ── Step 2: Generate clip via Veo ─────────────────────────────────────────
  logger.info('Producer: calling Veo generation');
  const clip = await generateClip(prompt, 8, format);
  logger.info('Producer: clip generated', { url: clip.videoUrl, cost: clip.cost });

  // Download clip to local temp file
  // TODO: implement clip download from fal.ai CDN URL to local path
  const rawPath = tempPath(`raw_${format}`);
  // Placeholder: in real implementation, download from clip.videoUrl
  logger.warn('Producer: clip download not implemented — TODO: download from CDN', { url: clip.videoUrl, rawPath });

  let currentPath = rawPath;
  let totalCost = clip.cost;

  // ── Step 3: Degrade video ─────────────────────────────────────────────────
  const degradedPath = tempPath(`degraded_${format}`);
  const subType = format === 'body_cam' ? (idea as BodyCamIdea).cam_sub_type : undefined;
  await degrade(currentPath, degradedPath, format, subType);
  currentPath = degradedPath;

  // ── Steps 4–6: Run gates with retry logic ─────────────────────────────────
  let attempt = 0;
  let cropSafe = true;
  const gateFailures: string[] = [];

  while (attempt < RETRY_POLICY.maxRetries) {
    attempt++;
    logger.info('Producer: running gate suite', { attempt, maxAttempts: RETRY_POLICY.maxRetries });

    // Extract keyframes for vision gates
    const frames = await extractKeyframes(currentPath, 5);

    // Gate 1: Motion
    const g1 = await runGate1(currentPath, format);
    if (!g1.pass) {
      if (g1.action === 'add_shake' && format === 'body_cam') {
        logger.info('Producer: Gate 1 add_shake — applying synthetic shake and re-running');
        const shakenPath = tempPath('shaken_body_cam');
        await addBodyCamShake(currentPath, shakenPath);
        currentPath = shakenPath;
        // Re-run Gate 1 immediately with shaken clip
        const g1b = await runGate1(currentPath, 'body_cam');
        if (!g1b.pass) {
          gateFailures.push(`gate1:${g1b.reason ?? 'shake insufficient'}`);
          if (attempt >= RETRY_POLICY.maxRetries) break;
          continue;
        }
      } else {
        gateFailures.push(`gate1:${g1.reason ?? 'motion fail'}`);
        if (attempt >= RETRY_POLICY.maxRetries) break;
        continue;
      }
    }

    // Gate 2: Face detection + auto-blur (always passes, may mutate currentPath)
    const g2 = await runGate2(currentPath);
    if (g2.blurred && g2.blurredVideoPath) {
      logger.info('Producer: Gate 2 applied face blur', { facesBlurred: g2.facesDetected });
      currentPath = g2.blurredVideoPath;
    }

    // Gate 3: Audio validation
    const g3 = await runGate3(currentPath, format, subType);
    if (!g3.pass) {
      if (g3.action === 'mix_bed' && g3.recommendedBed) {
        const bedPath = pickAudioBed(subType ?? g3.recommendedBed, env.AUDIO_BEDS_PATH);
        if (bedPath) {
          logger.info('Producer: Gate 3 mix_bed — mixing audio bed', { bed: bedPath });
          const mixedPath = tempPath('mixed_audio');
          await mixAudioBed(currentPath, bedPath, -15, mixedPath);
          currentPath = mixedPath;
          const g3b = await runGate3(currentPath, format, subType);
          if (!g3b.pass) {
            gateFailures.push(`gate3:${g3b.reason ?? 'audio still fails after bed mix'}`);
            if (attempt >= RETRY_POLICY.maxRetries) break;
            continue;
          }
        }
      } else if (g3.action === 'replace_audio') {
        // TODO: generate or fetch a replacement ambient audio track and call replaceAudio()
        logger.warn('Producer: Gate 3 replace_audio — TODO: implement ambient audio replacement');
        gateFailures.push(`gate3:${g3.reason ?? 'audio too loud'}`);
        if (attempt >= RETRY_POLICY.maxRetries) break;
        continue;
      } else {
        gateFailures.push(`gate3:${g3.reason ?? 'audio fail'}`);
        if (attempt >= RETRY_POLICY.maxRetries) break;
        continue;
      }
    }

    // Gate 4: Content policy (Stage B — post-generation)
    const g4 = await runGate4(currentPath, format, idea.scenario, frames);
    if (!g4.pass) {
      if (g4.hardFail) {
        // Hard fail — do not retry, reject permanently
        throw new Error(
          `Producer: Gate 4 HARD FAIL — ${g4.severity} severity: ${g4.flags.join(', ')}`,
        );
      }
      gateFailures.push(`gate4:${g4.reason ?? 'policy flags'}`);
      if (attempt >= RETRY_POLICY.maxRetries) break;
      continue;
    }

    // Gate 5: Crop safety — check whether center crop is safe
    // TODO: implement gate5-cropsafe.ts — analyses whether important content is
    //       within the center 9:16 safe zone. For now default to true.
    cropSafe = true;

    // Gate 6: Authenticity — checks overall authenticity score
    // TODO: implement gate6-authenticity.ts — Claude vision check for AI tell-tales
    // For now, all clips pass Gate 6.

    // Gate 7: Virality scoring
    // TODO: implement gate7-virality.ts — minimum virality score threshold
    // For now, all clips pass Gate 7.

    logger.info('Producer: all gates passed', { attempt });
    gateFailures.length = 0; // clear failures on success
    break;
  }

  if (gateFailures.length > 0) {
    throw new Error(`Producer: gates failed after ${attempt} attempt(s): ${gateFailures.join(' | ')}`);
  }

  // ── Step 8: Apply overlay ──────────────────────────────────────────────────
  const overlayTemplatePath = path.join(
    env.OVERLAYS_PATH,
    format,
    `${format === 'body_cam' ? (subType ?? 'police_security') : 'default'}.png`,
  );

  const overlaidPath = tempPath(`overlaid_${format}`);
  const overlayConfig = format === 'ring_cam'
    ? buildRingCamOverlayConfig(idea as RingCamIdea, overlayTemplatePath)
    : buildBodyCamOverlayConfig(idea as BodyCamIdea, overlayTemplatePath);

  await applyOverlay(currentPath, overlaidPath, format, overlayConfig);
  currentPath = overlaidPath;

  // ── Step 9: Burn disclosure watermark ─────────────────────────────────────
  const disclosurePath = tempPath(`disclosed_${format}`);
  await burnDisclosure(currentPath, disclosurePath);
  currentPath = disclosurePath;

  // ── Step 10: Crop to 9:16 if cropSafe ─────────────────────────────────────
  if (cropSafe) {
    const croppedPath = tempPath(`cropped_${format}`);
    await cropToVertical(currentPath, croppedPath, true);
    currentPath = croppedPath;
  }

  // ── Step 11: Upload to Cloudinary ─────────────────────────────────────────
  const publicId = `caught_on_camera/${format}_${idea.id}_${Date.now()}`;
  const cloudinaryUrl = await uploadToCloudinary(currentPath, publicId);

  // Track total cost
  const claudeCost = 0.01; // approximate cost of gate analysis calls
  totalCost += claudeCost;
  await trackCost({
    sceneId:    idea.id,
    veoCost:    clip.cost,
    claudeCost,
    veoVariant: `${format}_v1`,
  });

  logger.info('Producer: production complete', {
    ideaId: idea.id,
    format,
    cloudinaryUrl,
    totalCost,
    cropSafe,
  });

  return {
    sceneId:   idea.id,
    videoPath: currentPath,
    cost:      totalCost,
    cropSafe,
  };
}
