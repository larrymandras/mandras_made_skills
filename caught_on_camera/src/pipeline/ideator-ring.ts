/**
 * Ring Camera Ideator Agent — generates concepts for the ring_cam_ideas table.
 *
 * Uses Claude Sonnet to produce a batch of scene concepts that will be shot
 * from a fixed doorbell/porch camera perspective. Concepts are deduplicated
 * before insertion using the semantic dedup engine.
 */
import { generateCompletion } from '../ai/claude.js';
import {
  insertRingCamIdeas,
  getCategoryDistribution,
  type NewRingCamIdea,
  type RingCamCategory,
} from '../db/ideas.js';
import { checkDuplicate, getCategoryWeights } from './dedup.js';
import { logger } from '../utils/logger.js';
import { RING_CAM_CATEGORIES } from '../config.js';

// ── Prompts ───────────────────────────────────────────────────────────────────

// RING CAMERA IDEATOR SYSTEM PROMPT (PRD Section 5)
const RING_CAM_SYSTEM_PROMPT = `You are a viral video ideator for an AI-generated security camera found-footage channel.
Your job is to generate highly shareable, entertaining ring camera / doorbell camera concepts.

FORMAT RULES:
- Ring cam videos are shot from a FIXED, STATIC camera mounted at a doorbell or porch position
- The camera has a slight fisheye/wide-angle lens distortion
- Footage looks like real consumer doorbell cam footage (grainy, slight color shift)
- Scenarios happen in front of a house, at a doorstep, driveway, front yard, or street

CONTENT GUIDELINES:
- Focus on unexpected, funny, wholesome, eerie, or wow-moment encounters
- Animals approaching the camera are extremely viral (raccoons, deer, bears, birds)
- Paranormal/unexplained shadows and shapes perform well at night
- Wholesome moments (kids, neighbors, kindness) get strong engagement
- Weather events (fog, snow, lightning) work well for atmosphere
- Delivery interactions and package moments are relatable and shareable
- NEVER include violence, weapons, police/law enforcement, or anything harmful
- NEVER show recognizable real people or brand logos

OUTPUT FORMAT:
Return a JSON array with exactly the requested number of concept objects.
Each concept must have ALL of these fields:
{
  "title": "Short punchy title (max 8 words)",
  "hook": "One-sentence hook that would make someone stop scrolling",
  "scenario": "2-3 sentences describing exactly what happens in the clip",
  "category": "animals|paranormal|delivery|weather|wholesome|fails|night_shift",
  "camera_position": "Exact camera mount position (e.g. 'above front door looking down at porch')",
  "time_of_day": "dawn|morning|afternoon|dusk|night",
  "audio_notes": "What sounds are important (or null if ambient only)",
  "virality_score": <integer 1-100>,
  "virality_elements": ["element1", "element2"],
  "format_type": "single|compilation",
  "compilation_theme": "theme string if compilation, else null",
  "caption": "TikTok/Reels caption with emoji (max 150 chars)",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type { RingCamIdea } from '../db/ideas.js';

// ── Core generation ───────────────────────────────────────────────────────────

/**
 * Generate `count` ring-cam concept ideas via Claude Sonnet.
 * Category weights bias Claude toward under-represented categories.
 *
 * @param count            Number of concepts to generate (typically 15–20).
 * @param categoryWeights  Optional override for category bias weights.
 */
export async function generateRingCamIdeas(
  count: number,
  categoryWeights?: Record<string, number>,
): Promise<NewRingCamIdea[]> {
  logger.info('RingIdeator: generating ideas', { count });

  // Build category-weighting hint for the prompt
  const weightHint = categoryWeights
    ? '\n\nCATEGORY DISTRIBUTION GUIDANCE:\n' +
      Object.entries(categoryWeights)
        .sort(([, a], [, b]) => b - a)
        .map(([cat, w]) => `  ${cat}: ${(w * 100).toFixed(0)}% of generated ideas`)
        .join('\n')
    : '';

  const userPrompt =
    `Generate exactly ${count} ring camera video concepts.${weightHint}\n\n` +
    `Return ONLY a valid JSON array — no markdown, no explanation, no code fences.`;

  const response = await generateCompletion(userPrompt, RING_CAM_SYSTEM_PROMPT, 4_000);

  // Parse JSON array from response
  let parsed: unknown[];
  try {
    // Strip any accidental markdown fences
    const clean = response.text.replace(/```(?:json)?/g, '').trim();
    const arrayStart = clean.indexOf('[');
    const arrayEnd = clean.lastIndexOf(']');
    if (arrayStart === -1 || arrayEnd === -1) throw new Error('No JSON array found');
    parsed = JSON.parse(clean.slice(arrayStart, arrayEnd + 1)) as unknown[];
  } catch (err) {
    logger.error('RingIdeator: failed to parse Claude response', { err, text: response.text.slice(0, 200) });
    throw new Error(`RingIdeator: invalid JSON in Claude response: ${String(err)}`);
  }

  // Validate and coerce each idea
  const ideas: NewRingCamIdea[] = [];
  for (const raw of parsed) {
    const obj = raw as Record<string, unknown>;
    try {
      const idea = coerceRingIdea(obj);
      ideas.push(idea);
    } catch (err) {
      logger.warn('RingIdeator: skipping malformed idea', { err, raw });
    }
  }

  logger.info('RingIdeator: parsed ideas', { total: ideas.length });
  return ideas;
}

/**
 * Full ideation run:
 * 1. Fetch category distribution to compute inverse weights.
 * 2. Generate 15–20 concepts via Claude.
 * 3. Deduplicate each concept against the last 30 days.
 * 4. Insert survivors into ring_cam_ideas.
 */
export async function runRingCamIdeator(): Promise<void> {
  logger.info('RingIdeator: starting full run');

  // Compute category weights based on recent production history
  const weights = await getCategoryWeights('ring_cam');
  logger.info('RingIdeator: category weights', { weights });

  // Generate a batch (overshoot slightly to absorb dedup losses)
  const COUNT = 18;
  const ideas = await generateRingCamIdeas(COUNT, weights);

  // Deduplicate each idea
  const survivors: NewRingCamIdea[] = [];
  for (const idea of ideas) {
    const dupResult = await checkDuplicate(
      { title: idea.title, scenario: idea.scenario, category: idea.category },
      'ring_cam',
    );
    if (dupResult.isDuplicate) {
      logger.info('RingIdeator: dedup reject', {
        title: idea.title,
        similarity: dupResult.similarity,
        reason: dupResult.reason,
      });
      continue;
    }
    survivors.push(idea);
  }

  logger.info('RingIdeator: dedup complete', {
    generated: ideas.length,
    survivors: survivors.length,
    rejected: ideas.length - survivors.length,
  });

  await insertRingCamIdeas(survivors);
  logger.info('RingIdeator: run complete', { inserted: survivors.length });
}

// ── Validation / coercion helpers ─────────────────────────────────────────────

function coerceRingIdea(obj: Record<string, unknown>): NewRingCamIdea {
  const validCategories = new Set<string>(RING_CAM_CATEGORIES);

  const category = String(obj['category'] ?? 'animals');
  if (!validCategories.has(category)) {
    throw new Error(`Invalid category: ${category}`);
  }

  return {
    title:              String(obj['title'] ?? '').slice(0, 100),
    hook:               String(obj['hook'] ?? ''),
    scenario:           String(obj['scenario'] ?? ''),
    category:           category as RingCamCategory,
    camera_position:    String(obj['camera_position'] ?? ''),
    time_of_day:        String(obj['time_of_day'] ?? 'night'),
    audio_notes:        obj['audio_notes'] ? String(obj['audio_notes']) : null,
    virality_score:     Math.min(100, Math.max(1, Number(obj['virality_score'] ?? 50))),
    virality_elements:  Array.isArray(obj['virality_elements'])
      ? (obj['virality_elements'] as unknown[]).map(String)
      : [],
    format_type:        obj['format_type'] === 'compilation' ? 'compilation' : 'single',
    compilation_theme:  obj['compilation_theme'] ? String(obj['compilation_theme']) : null,
    caption:            String(obj['caption'] ?? '').slice(0, 150),
    hashtags:           Array.isArray(obj['hashtags'])
      ? (obj['hashtags'] as unknown[]).map(String).slice(0, 20)
      : [],
  };
}
