/**
 * Gate 1 — Character Consistency
 * Scores each scene against character reference images via Claude vision.
 * Score >= 95: auto-save as reference frame. Score < 70: mark scene degraded.
 */
import { readFile } from 'node:fs/promises';
import { runVisionAnalysis } from '../ai/claude.js';
import { loadSheet } from '../characters/sheet-loader.js';
import {
  getActiveReferenceByPose,
  saveConsistencyScore,
  saveReferenceFrame,
} from '../db/characters.js';
import { logger } from '../utils/logger.js';
import { CONSISTENCY } from '../config.js';

export interface Gate1Result {
  pass: boolean;
  score: number;
  characterName: string;
  savedAsReference: boolean;
  poseUsed: string;
}

export async function runGate1(
  sceneId: string,
  characterName: string,
  frameBase64Images: string[],
  targetPose?: string,
): Promise<Gate1Result> {
  logger.info('Gate 1: character consistency check', { sceneId, characterName, targetPose });

  // 1. Load character sheet and build physical description
  const sheet = await loadSheet(characterName);
  const p = sheet.physical;

  const physicalDescription = [
    `Build: ${p.build}`,
    `Fur color: ${p.fur.color}`,
    `Fur texture: ${p.fur.texture}`,
    `Seasonal variation: ${p.fur.seasonal_variation}`,
    `Eyes: ${p.face.eyes}`,
    `Brow: ${p.face.brow}`,
    `Nose: ${p.face.nose}`,
    `Mouth: ${p.face.mouth}`,
    `Teeth: ${p.face.teeth}`,
    `Default expression: ${p.face.expression_default}`,
    `Hands: ${p.hands}`,
    `Feet: ${p.feet}`,
    `Distinguishing marks: ${p.distinguishing_marks.join('; ')}`,
    `Clothing: ${p.clothing.join('; ')}`,
  ].join('\n');

  // 2. Look up the best pose-matched reference image
  const referenceRecord = await getActiveReferenceByPose(
    characterName,
    targetPose ?? 'front',
  );

  if (!referenceRecord) {
    logger.warn('Gate 1: no reference image available — skipping consistency check', {
      sceneId,
      characterName,
    });
    return {
      pass: true,
      score: 0,
      characterName,
      savedAsReference: false,
      poseUsed: 'none',
    };
  }

  // 3. Read the reference image from disk and convert to base64
  const refFilePath = referenceRecord['file_path'] as string;
  const refPose = (referenceRecord['pose'] as string) ?? 'unknown';
  let refBase64: string;

  try {
    const refBuffer = await readFile(refFilePath);
    refBase64 = refBuffer.toString('base64');
  } catch (err) {
    logger.error('Gate 1: failed to read reference image', {
      sceneId,
      characterName,
      refFilePath,
      error: (err as Error).message,
    });
    return {
      pass: true,
      score: 0,
      characterName,
      savedAsReference: false,
      poseUsed: refPose,
    };
  }

  // 4. Build vision prompt and run analysis
  const prompt = `You are a character consistency evaluator for an animated series.

## Character Physical Description
${physicalDescription}

## Task
The FIRST image is the canonical reference image for the character "${sheet.name}".
The REMAINING images are frames from a new scene that should depict the same character.

Compare the scene frames against the reference image and evaluate visual consistency.

Check the following attributes carefully:
- Fur/hair color accuracy
- Eye color accuracy
- Body proportions and build
- Distinguishing marks (scars, patterns, unique features)
- Overall silhouette and shape
- Clothing consistency (if applicable)

Score the consistency from 0 to 100, where:
- 100 = perfect match, indistinguishable from reference
- 90-99 = excellent, minor variations acceptable for animation
- 70-89 = acceptable, noticeable differences but recognizably the same character
- 50-69 = degraded, significant deviations from reference
- 0-49 = failed, does not look like the same character

Respond with ONLY a JSON object in this exact format:
{ "score": N, "notes": "brief explanation" }`;

  // Reference image first, then scene frames
  const allImages = [refBase64, ...frameBase64Images];

  const rawResponse = await runVisionAnalysis({ text: prompt, images: allImages }, 300);

  // 5. Parse the score from Claude's response
  let score = 0;
  let notes = '';

  try {
    // Extract JSON from the response (handle markdown code blocks too)
    const jsonMatch = rawResponse.match(/\{[\s\S]*?"score"\s*:\s*(\d+)[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { score: number; notes?: string };
      score = Math.max(0, Math.min(100, parsed.score));
      notes = parsed.notes ?? '';
    } else {
      logger.warn('Gate 1: could not parse score from vision response', {
        sceneId,
        rawResponse,
      });
    }
  } catch (err) {
    logger.error('Gate 1: failed to parse vision response', {
      sceneId,
      rawResponse,
      error: (err as Error).message,
    });
  }

  // 6. Save the consistency score
  const savedAsReference = score >= CONSISTENCY.saveAbove;

  await saveConsistencyScore({
    sceneId,
    characterName,
    score,
    details: { notes, poseUsed: refPose, targetPose: targetPose ?? 'front' },
    savedAsReference,
  });

  // 7. If score is high enough, auto-save the best frame as a new reference
  if (savedAsReference && frameBase64Images.length > 0) {
    await saveReferenceFrame({
      characterName,
      filePath: refFilePath,
      consistencyScore: score,
      pose: targetPose ?? refPose,
    });
    logger.info('Gate 1: auto-saved frame as new reference', {
      sceneId,
      characterName,
      score,
      pose: targetPose ?? refPose,
    });
  }

  const pass = score >= CONSISTENCY.rejectBelow;

  logger.info('Gate 1: complete', {
    sceneId,
    characterName,
    score,
    pass,
    savedAsReference,
    poseUsed: refPose,
    notes,
  });

  return {
    pass,
    score,
    characterName,
    savedAsReference,
    poseUsed: refPose,
  };
}
