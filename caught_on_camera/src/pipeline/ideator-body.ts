/**
 * Body Camera Ideator Agent — generates concepts for the body_cam_ideas table.
 *
 * Covers four sub-types of body cam footage: police_security, hiker_trail,
 * dashcam, and helmet_action. Each sub-type has distinct motion characteristics
 * and audio expectations that are communicated to the model in the system prompt.
 */
import { generateCompletion } from '../ai/claude.js';
import {
  insertBodyCamIdeas,
  type NewBodyCamIdea,
  type BodyCamCategory,
  type CamSubType,
} from '../db/ideas.js';
import { checkDuplicate, getCategoryWeights } from './dedup.js';
import { logger } from '../utils/logger.js';
import { BODY_CAM_CATEGORIES, BODY_CAM_SUB_TYPES } from '../config.js';

// ── Prompts ───────────────────────────────────────────────────────────────────

// BODY CAMERA IDEATOR SYSTEM PROMPT (PRD Section 6)
const BODY_CAM_SYSTEM_PROMPT = `You are a viral video ideator for an AI-generated body camera found-footage channel.
Your job is to generate highly shareable, authentic-feeling body camera encounter concepts.

BODY CAM SUB-TYPES:
1. police_security — Security guard or patrol person on duty. Slow deliberate walking motion.
   Typical audio: radio chatter, footsteps on pavement. Night-shift scenarios work well.
2. hiker_trail — Trail hiker or nature explorer. Rhythmic walking motion.
   Audio: footsteps on gravel/dirt, wind, birds. Dense forest or open trail settings.
3. dashcam — Dashboard-mounted car camera. Camera is stable but road movement visible.
   Audio: engine hum, road noise, occasional traffic. Highway or urban scenarios.
4. helmet_action — Cyclist, biker, or mountain sport. Active, high-motion footage.
   Audio: wind rush, exertion breath, mechanical sounds. Outdoor sport settings.

CONTENT GUIDELINES:
- Scenarios should feel like they could be real captured footage — authentic and believable
- Encounters with animals in unexpected places are extremely viral
- Weather phenomena, unusual atmospheric events, and strange sounds work well
- Discovery moments (finding something unexpected) drive strong engagement
- Night-vision / low-light footage with motion triggers high watch time
- DO NOT include: violence, arrests, use of force, weapons, real criminal activity
- DO NOT portray real law enforcement making an arrest or use of force
- DO NOT include children in any scenario
- Security or patrol characters may be present but only in benign patrol/discovery contexts

OUTPUT FORMAT:
Return a JSON array with exactly the requested number of concept objects.
Each concept must have ALL of these fields:
{
  "title": "Short punchy title (max 8 words)",
  "hook": "One-sentence hook that would make someone stop scrolling",
  "scenario": "2-3 sentences describing exactly what happens in the clip",
  "category": "encounter|pursuit|discovery|weather_nature|night_ops|response|dashcam_chaos",
  "cam_sub_type": "police_security|hiker_trail|dashcam|helmet_action",
  "movement_notes": "Description of camera movement pattern (or null if standard walking)",
  "time_of_day": "dawn|morning|afternoon|dusk|night",
  "audio_notes": "Key audio elements expected in this clip (or null if ambient only)",
  "virality_score": <integer 1-100>,
  "virality_elements": ["element1", "element2"],
  "format_type": "single|compilation",
  "compilation_theme": "theme string if compilation, else null",
  "caption": "TikTok/Reels caption with emoji (max 150 chars)",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type { BodyCamIdea } from '../db/ideas.js';

// ── Core generation ───────────────────────────────────────────────────────────

/**
 * Generate `count` body-cam concept ideas via Claude Sonnet.
 *
 * @param count            Number of concepts to generate (typically 15–20).
 * @param categoryWeights  Optional override for category bias weights.
 */
export async function generateBodyCamIdeas(
  count: number,
  categoryWeights?: Record<string, number>,
): Promise<NewBodyCamIdea[]> {
  logger.info('BodyIdeator: generating ideas', { count });

  // Build category-weighting and sub-type diversity hints
  const weightHint = categoryWeights
    ? '\n\nCATEGORY DISTRIBUTION GUIDANCE:\n' +
      Object.entries(categoryWeights)
        .sort(([, a], [, b]) => b - a)
        .map(([cat, w]) => `  ${cat}: ${(w * 100).toFixed(0)}% of generated ideas`)
        .join('\n')
    : '';

  // Encourage sub-type diversity
  const subTypeHint =
    '\n\nSUB-TYPE DIVERSITY: Distribute concepts across all four sub-types roughly equally. ' +
    'Vary the sub-type selection — do not generate more than 40% of ideas for any single sub-type.';

  const userPrompt =
    `Generate exactly ${count} body camera video concepts.${weightHint}${subTypeHint}\n\n` +
    `Return ONLY a valid JSON array — no markdown, no explanation, no code fences.`;

  const response = await generateCompletion(userPrompt, BODY_CAM_SYSTEM_PROMPT, 4_000);

  // Parse JSON array from response
  let parsed: unknown[];
  try {
    const clean = response.text.replace(/```(?:json)?/g, '').trim();
    const arrayStart = clean.indexOf('[');
    const arrayEnd = clean.lastIndexOf(']');
    if (arrayStart === -1 || arrayEnd === -1) throw new Error('No JSON array found');
    parsed = JSON.parse(clean.slice(arrayStart, arrayEnd + 1)) as unknown[];
  } catch (err) {
    logger.error('BodyIdeator: failed to parse Claude response', { err, text: response.text.slice(0, 200) });
    throw new Error(`BodyIdeator: invalid JSON in Claude response: ${String(err)}`);
  }

  // Validate and coerce each idea
  const ideas: NewBodyCamIdea[] = [];
  for (const raw of parsed) {
    const obj = raw as Record<string, unknown>;
    try {
      const idea = coerceBodyIdea(obj);
      ideas.push(idea);
    } catch (err) {
      logger.warn('BodyIdeator: skipping malformed idea', { err, raw });
    }
  }

  logger.info('BodyIdeator: parsed ideas', { total: ideas.length });
  return ideas;
}

/**
 * Full ideation run:
 * 1. Fetch category distribution to compute inverse weights.
 * 2. Generate 15–20 concepts via Claude.
 * 3. Deduplicate each concept against the last 30 days (both tables).
 * 4. Insert survivors into body_cam_ideas.
 */
export async function runBodyCamIdeator(): Promise<void> {
  logger.info('BodyIdeator: starting full run');

  const weights = await getCategoryWeights('body_cam');
  logger.info('BodyIdeator: category weights', { weights });

  const COUNT = 18;
  const ideas = await generateBodyCamIdeas(COUNT, weights);

  const survivors: NewBodyCamIdea[] = [];
  for (const idea of ideas) {
    const dupResult = await checkDuplicate(
      { title: idea.title, scenario: idea.scenario, category: idea.category },
      'body_cam',
    );
    if (dupResult.isDuplicate) {
      logger.info('BodyIdeator: dedup reject', {
        title: idea.title,
        similarity: dupResult.similarity,
        reason: dupResult.reason,
      });
      continue;
    }
    survivors.push(idea);
  }

  logger.info('BodyIdeator: dedup complete', {
    generated: ideas.length,
    survivors: survivors.length,
    rejected: ideas.length - survivors.length,
  });

  await insertBodyCamIdeas(survivors);
  logger.info('BodyIdeator: run complete', { inserted: survivors.length });
}

// ── Validation / coercion helpers ─────────────────────────────────────────────

function coerceBodyIdea(obj: Record<string, unknown>): NewBodyCamIdea {
  const validCategories = new Set<string>(BODY_CAM_CATEGORIES);
  const validSubTypes = new Set<string>(BODY_CAM_SUB_TYPES);

  const category = String(obj['category'] ?? 'encounter');
  if (!validCategories.has(category)) {
    throw new Error(`Invalid category: ${category}`);
  }

  const camSubType = String(obj['cam_sub_type'] ?? 'police_security');
  if (!validSubTypes.has(camSubType)) {
    throw new Error(`Invalid cam_sub_type: ${camSubType}`);
  }

  return {
    title:              String(obj['title'] ?? '').slice(0, 100),
    hook:               String(obj['hook'] ?? ''),
    scenario:           String(obj['scenario'] ?? ''),
    category:           category as BodyCamCategory,
    cam_sub_type:       camSubType as CamSubType,
    movement_notes:     obj['movement_notes'] ? String(obj['movement_notes']) : null,
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
