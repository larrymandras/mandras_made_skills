/**
 * Producer — generates video and audio for each scene.
 * Per-scene: video generation → voice synthesis → Gates 1, 2, 3.
 * Retries once on gate failure. Marks scene 'degraded' if retry fails (does not abort).
 */
import { logger } from '../utils/logger.js';
import { generateSceneClip } from '../ai/veo.js';
import { synthesizeNarration } from '../ai/voice.js';
import { runAllGates } from '../gates/index.js';
import { extractFrames, frameToBase64 } from '../media/frames.js';
import { getVisualDirectionForPrompt, loadSheet } from '../characters/index.js';
import type { SceneScript } from './scriptwriter.js';
import type { Concept } from './ideator.js';

export interface ProducedScene {
  sceneIndex: number;
  videoPath: string;
  audioPath: string;
  status: 'gates_passed' | 'degraded' | 'failed';
  gate1Score: number;
  targetPose: string;
}

/**
 * Resolve the primary character name for a scene.
 *
 * If the concept focuses on a single character, that is always the answer.
 * For 'both', we default to the first character ('yeti') — future improvement
 * could infer per-scene character from dialogue/narration content.
 */
function resolvePrimaryCharacter(focus: Concept['characterFocus']): string {
  switch (focus) {
    case 'yeti':
      return 'yeti';
    case 'bigfoot':
      return 'bigfoot';
    case 'both':
      return 'yeti'; // default primary; scenes featuring bigfoot can be refined later
  }
}

/**
 * Build an enriched video generation prompt by combining the scene's visual
 * direction from the script with character sheet visual direction and pose
 * personality context.
 */
async function buildVideoPrompt(
  scene: SceneScript,
  characterName: string,
): Promise<string> {
  const visualDirection = await getVisualDirectionForPrompt(characterName);
  const sheet = await loadSheet(characterName);
  const poseMap = sheet.visual_direction.pose_personality_map;

  const parts: string[] = [];

  // Scene-specific visual direction from the scriptwriter
  parts.push(`## Scene Visual Direction\n${scene.visualDirection}`);

  // Character visual direction (palette, lighting, angles, environments)
  parts.push(visualDirection);

  // Target pose and its personality description
  parts.push(`## Target Pose: ${scene.targetPose}`);
  const poseDescription = poseMap[scene.targetPose];
  if (poseDescription) {
    parts.push(`Pose body language: ${poseDescription}`);
  }

  // Brief narration/dialogue context for scene mood
  parts.push(`## Scene Context\nNarration: ${scene.narration}`);
  if (scene.dialogue) {
    parts.push(`Dialogue: ${scene.dialogue}`);
  }

  return parts.join('\n\n');
}

/**
 * Produce a single scene: generate video, synthesize voice, run gates.
 * Returns the ProducedScene result. On gate failure, retries video generation
 * once before marking the scene as degraded.
 */
async function produceOneScene(
  videoId: string,
  scene: SceneScript,
  characterName: string,
  prevLastFrameBase64?: string,
): Promise<ProducedScene> {
  const sceneId = `${videoId}_s${scene.sceneIndex}`;
  const videoPath = `output/${videoId}/scene_${scene.sceneIndex}.mp4`;
  const audioPath = `output/${videoId}/scene_${scene.sceneIndex}.mp3`;

  // 1. Build enriched video prompt with character sheet context
  const videoPrompt = await buildVideoPrompt(scene, characterName);

  // 2. Generate video
  let currentVideoPath: string;
  try {
    currentVideoPath = await generateSceneClip(
      {
        prompt: videoPrompt,
        durationSeconds: scene.estimatedDurationSeconds,
      },
      videoPath,
    );
  } catch (err) {
    logger.error('Producer: video generation failed', { sceneId, err });
    return {
      sceneIndex: scene.sceneIndex,
      videoPath: '',
      audioPath: '',
      status: 'failed',
      gate1Score: 0,
      targetPose: scene.targetPose,
    };
  }

  // 3. Synthesize narration audio
  let currentAudioPath: string;
  const narrationText = scene.dialogue
    ? `${scene.narration} ${scene.dialogue}`
    : scene.narration;
  try {
    currentAudioPath = await synthesizeNarration(narrationText, characterName, audioPath);
  } catch (err) {
    logger.error('Producer: voice synthesis failed', { sceneId, err });
    return {
      sceneIndex: scene.sceneIndex,
      videoPath: currentVideoPath,
      audioPath: '',
      status: 'failed',
      gate1Score: 0,
      targetPose: scene.targetPose,
    };
  }

  // 4. Extract frames for gate analysis
  const frames = await extractFrames(currentVideoPath);
  const frameImages = await Promise.all(frames.map((f) => frameToBase64(f)));

  const scriptText = `${scene.narration}\n${scene.dialogue}`;
  const firstFrameBase64 = frameImages[0];

  // 5. Run gates (first attempt)
  const gateResult = await runAllGates({
    sceneId,
    characterName,
    frameBase64Images: frameImages,
    videoPath: currentVideoPath,
    audioPath: currentAudioPath,
    scriptText,
    prevSceneLastFrameBase64: prevLastFrameBase64,
    currentSceneFirstFrameBase64: firstFrameBase64,
    targetPose: scene.targetPose,
  });

  if (gateResult.pass) {
    logger.info('Producer: gates passed', { sceneId, gate1Score: gateResult.gate1?.score });
    return {
      sceneIndex: scene.sceneIndex,
      videoPath: currentVideoPath,
      audioPath: currentAudioPath,
      status: 'gates_passed',
      gate1Score: gateResult.gate1?.score ?? 0,
      targetPose: scene.targetPose,
    };
  }

  // Hard fail — no retry (policy violation, watermark, etc.)
  if (gateResult.hardFail) {
    logger.warn('Producer: hard fail on gate', {
      sceneId,
      gate: gateResult.hardFailGate,
    });
    return {
      sceneIndex: scene.sceneIndex,
      videoPath: currentVideoPath,
      audioPath: currentAudioPath,
      status: 'failed',
      gate1Score: gateResult.gate1?.score ?? 0,
      targetPose: scene.targetPose,
    };
  }

  // 6. Soft fail — retry video generation once
  logger.warn('Producer: gates soft-failed, retrying video generation', { sceneId });

  try {
    const retryVideoPath = `output/${videoId}/scene_${scene.sceneIndex}_retry.mp4`;
    currentVideoPath = await generateSceneClip(
      {
        prompt: videoPrompt,
        durationSeconds: scene.estimatedDurationSeconds,
      },
      retryVideoPath,
    );

    const retryFrames = await extractFrames(currentVideoPath);
    const retryFrameImages = await Promise.all(retryFrames.map((f) => frameToBase64(f)));
    const retryFirstFrame = retryFrameImages[0];

    const retryGateResult = await runAllGates({
      sceneId: `${sceneId}_retry`,
      characterName,
      frameBase64Images: retryFrameImages,
      videoPath: currentVideoPath,
      audioPath: currentAudioPath,
      scriptText,
      prevSceneLastFrameBase64: prevLastFrameBase64,
      currentSceneFirstFrameBase64: retryFirstFrame,
      targetPose: scene.targetPose,
    });

    if (retryGateResult.pass) {
      logger.info('Producer: retry gates passed', { sceneId });
      return {
        sceneIndex: scene.sceneIndex,
        videoPath: currentVideoPath,
        audioPath: currentAudioPath,
        status: 'gates_passed',
        gate1Score: retryGateResult.gate1?.score ?? 0,
        targetPose: scene.targetPose,
      };
    }

    // Retry also failed — mark degraded (do not abort)
    logger.warn('Producer: retry also failed gates, marking degraded', { sceneId });
    return {
      sceneIndex: scene.sceneIndex,
      videoPath: currentVideoPath,
      audioPath: currentAudioPath,
      status: 'degraded',
      gate1Score: retryGateResult.gate1?.score ?? 0,
      targetPose: scene.targetPose,
    };
  } catch (retryErr) {
    logger.error('Producer: retry video generation threw', { sceneId, retryErr });
    return {
      sceneIndex: scene.sceneIndex,
      videoPath: currentVideoPath,
      audioPath: currentAudioPath,
      status: 'degraded',
      gate1Score: gateResult.gate1?.score ?? 0,
      targetPose: scene.targetPose,
    };
  }
}

export async function produceScenes(
  videoId: string,
  scripts: SceneScript[],
  characterFocus: Concept['characterFocus'],
): Promise<ProducedScene[]> {
  logger.info('Producer: generating scenes', { videoId, count: scripts.length });

  const characterName = resolvePrimaryCharacter(characterFocus);

  // Pre-load the character sheet so it's cached for all scenes
  await loadSheet(characterName);

  const results: ProducedScene[] = [];
  let prevLastFrameBase64: string | undefined;

  // Process scenes sequentially to maintain continuity (prev scene's last frame)
  for (const scene of scripts) {
    const produced = await produceOneScene(
      videoId,
      scene,
      characterName,
      prevLastFrameBase64,
    );
    results.push(produced);

    // Capture last frame of current scene for next scene's continuity gate
    if (produced.videoPath) {
      try {
        const frames = await extractFrames(produced.videoPath);
        if (frames.length > 0) {
          prevLastFrameBase64 = await frameToBase64(frames[frames.length - 1]);
        }
      } catch {
        // Non-critical — continuity gate will just run without prev frame
        prevLastFrameBase64 = undefined;
      }
    }
  }

  const passedCount = results.filter((r) => r.status === 'gates_passed').length;
  const degradedCount = results.filter((r) => r.status === 'degraded').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;

  logger.info('Producer: complete', {
    videoId,
    passed: passedCount,
    degraded: degradedCount,
    failed: failedCount,
  });

  return results;
}
