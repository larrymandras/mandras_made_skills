/**
 * Scriptwriter — generates N scene scripts from a concept.
 * Validates character memory integrity before writing (callbacks must reference real episodes).
 */
import { runTextAnalysis } from '../ai/claude.js';
import { validateMemoryIntegrity } from '../db/memory.js';
import { logger } from '../utils/logger.js';
import type { Concept } from './ideator.js';
import {
  loadSheet,
  getSheetSummaryForPrompt,
  getVisualDirectionForPrompt,
  CANONICAL_POSES,
  type PoseTag,
} from '../characters/index.js';

export interface SceneScript {
  sceneIndex: number;
  narration: string;
  dialogue: string;
  visualDirection: string;
  estimatedDurationSeconds: number;
  targetPose: string;
}

/**
 * Determine which character names to load based on the concept's characterFocus.
 */
function resolveCharacters(focus: Concept['characterFocus']): string[] {
  switch (focus) {
    case 'yeti':
      return ['yeti'];
    case 'bigfoot':
      return ['bigfoot'];
    case 'both':
      return ['yeti', 'bigfoot'];
  }
}

/**
 * Build the system prompt containing character sheets, visual direction,
 * canonical poses, and writing constraints.
 */
function buildSystemPrompt(
  sheetSummaries: string[],
  visualDirections: string[],
  guestSummary?: string,
): string {
  const posesListStr = CANONICAL_POSES.map((p) => `  - "${p}"`).join('\n');

  const guestBlock = guestSummary
    ? `\n\n---\n\n## Guest Character\n${guestSummary}\n\n### Guest Appearance Guidelines\n- The guest should appear in 2-3 scenes out of the total, NOT every scene.\n- Write the guest's dialogue to match their speech patterns and personality.\n- Show how the guest interacts with and plays off the lead characters.\n- The guest adds flavor but the leads remain the stars of the episode.`
    : '';

  return `You are a comedy scriptwriter for a short-form cryptid vlog series.
You write scene-by-scene scripts for vertical video content (TikTok/YouTube Shorts).

${sheetSummaries.join('\n\n---\n\n')}

---

${visualDirections.join('\n\n---\n\n')}${guestBlock}

---

## Valid Poses (targetPose must be one of these)
${posesListStr}

## Writing Constraints
- Write dialogue that matches each character's speech_patterns and verbal_tics exactly.
- Use at least one catchphrase per character per video. Vary which catchphrase you use across episodes.
- The "never_say" and "never_do" lists are HARD constraints — never violate them under any circumstances.
- Reference running_jokes naturally when they fit the scene. Do not force every running joke into every episode.
- Each scene must include a targetPose from the valid poses list above. Choose the pose that best matches the scene's visual direction and emotional beat.
- Each scene needs: narration, dialogue, visualDirection (describe the shot composition and action, including the character pose), and estimatedDurationSeconds (6–15 seconds).
- The sceneIndex should be sequential starting from 0.

Respond ONLY with a JSON array of scene objects. No markdown fences, no commentary — just the raw JSON array.`;
}

/**
 * Build the user prompt with concept details and output format.
 */
function buildUserPrompt(concept: Concept): string {
  return `Write a ${concept.sceneCount}-scene script for a cryptid vlog episode.

Title: "${concept.conceptTitle}"
Hook: ${concept.hook}
Scene count: ${concept.sceneCount}
Character focus: ${concept.characterFocus}

Return a JSON array of objects with this exact shape:
[
  {
    "sceneIndex": 0,
    "narration": "...",
    "dialogue": "...",
    "visualDirection": "...",
    "estimatedDurationSeconds": 8,
    "targetPose": "front"
  }
]

Each scene's estimatedDurationSeconds must be between 6 and 15.
Each scene's targetPose must be one of the valid canonical poses listed in the system prompt.`;
}

/**
 * Attempt to parse a JSON array of SceneScript objects from a raw AI response.
 * Strips markdown fences and leading/trailing noise before parsing.
 */
function parseSceneScripts(raw: string): SceneScript[] {
  let cleaned = raw.trim();

  // Strip markdown code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try to find the JSON array boundaries
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  }

  const parsed = JSON.parse(cleaned) as SceneScript[];

  if (!Array.isArray(parsed)) {
    throw new Error('Parsed response is not an array');
  }

  // Basic structural validation
  for (const scene of parsed) {
    if (typeof scene.sceneIndex !== 'number') {
      throw new Error(`Scene missing sceneIndex: ${JSON.stringify(scene)}`);
    }
    if (typeof scene.narration !== 'string' || typeof scene.dialogue !== 'string') {
      throw new Error(`Scene ${scene.sceneIndex} missing narration or dialogue`);
    }
    if (typeof scene.visualDirection !== 'string') {
      throw new Error(`Scene ${scene.sceneIndex} missing visualDirection`);
    }
    if (typeof scene.estimatedDurationSeconds !== 'number') {
      throw new Error(`Scene ${scene.sceneIndex} missing estimatedDurationSeconds`);
    }
    if (typeof scene.targetPose !== 'string') {
      throw new Error(`Scene ${scene.sceneIndex} missing targetPose`);
    }
  }

  return parsed;
}

export async function writeScript(concept: Concept): Promise<SceneScript[]> {
  logger.info('Scriptwriter: writing script', { title: concept.conceptTitle, scenes: concept.sceneCount });

  // 1. Determine involved characters
  const characterNames = resolveCharacters(concept.characterFocus);

  // 2. Load character sheets and build prompt summaries
  const sheetSummaries: string[] = [];
  const visualDirections: string[] = [];

  await Promise.all(
    characterNames.map(async (name) => {
      await loadSheet(name); // ensure sheet is loaded/cached
      const summary = await getSheetSummaryForPrompt(name);
      const visual = await getVisualDirectionForPrompt(name);
      sheetSummaries.push(summary);
      visualDirections.push(visual);
    }),
  );

  // 2b. Load guest character sheet if one is cast
  let guestSummary: string | undefined;
  if (concept.guestCharacter) {
    try {
      await loadSheet(concept.guestCharacter);
      guestSummary = await getSheetSummaryForPrompt(concept.guestCharacter);
      logger.info('Scriptwriter: loaded guest character sheet', { guest: concept.guestCharacter });
    } catch (err) {
      logger.warn('Scriptwriter: failed to load guest sheet, continuing without guest', {
        guest: concept.guestCharacter,
        error: (err as Error).message,
      });
    }
  }

  // 3. Build prompts
  const systemPrompt = buildSystemPrompt(sheetSummaries, visualDirections, guestSummary);
  const userPrompt = buildUserPrompt(concept);
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  // 4. Call Claude (with one retry on parse failure)
  let scenes: SceneScript[];
  let rawResponse: string;

  try {
    // Estimate token budget: ~200 tokens per scene + overhead
    const maxTokens = Math.max(2000, concept.sceneCount * 300);
    rawResponse = await runTextAnalysis(fullPrompt, maxTokens);
    scenes = parseSceneScripts(rawResponse);
  } catch (firstError) {
    logger.warn('Scriptwriter: first attempt failed, retrying', {
      error: (firstError as Error).message,
    });

    try {
      const maxTokens = Math.max(2000, concept.sceneCount * 300);
      rawResponse = await runTextAnalysis(fullPrompt, maxTokens);
      scenes = parseSceneScripts(rawResponse);
    } catch (retryError) {
      throw new Error(
        `Scriptwriter: failed to generate valid script after 2 attempts. ` +
        `Last error: ${(retryError as Error).message}`,
      );
    }
  }

  logger.info('Scriptwriter: generated scenes', { count: scenes.length });

  // 5. Memory validation — concatenate all narration + dialogue for callback checking
  const fullScriptText = scenes
    .map((s) => `${s.narration}\n${s.dialogue}`)
    .join('\n\n');

  try {
    const integrity = await validateMemoryIntegrity(fullScriptText);
    if (!integrity.valid) {
      logger.warn('Scriptwriter: memory integrity issues detected', {
        issues: integrity.issues,
      });
    }
  } catch (memErr) {
    logger.warn('Scriptwriter: memory validation failed (non-blocking)', {
      error: (memErr as Error).message,
    });
  }

  return scenes;
}
