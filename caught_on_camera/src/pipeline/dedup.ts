/**
 * Semantic deduplication engine.
 *
 * Uses Claude to check whether a new idea is semantically similar to ideas
 * generated in the last 30 days. Category weights are computed using inverse
 * frequency: categories with fewer recent ideas get higher weights so the
 * ideator is nudged toward under-represented territory.
 */
import { generateCompletion } from '../ai/claude.js';
import { getAllRecentIdeas, getCategoryDistribution } from '../db/ideas.js';
import { logger } from '../utils/logger.js';
import { RING_CAM_CATEGORIES, BODY_CAM_CATEGORIES } from '../config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  similarity: 'none' | 'low' | 'medium' | 'high';
  similarTo?: string;
  reason: string;
}

// ── Similarity check ──────────────────────────────────────────────────────────

/**
 * Check whether a new idea is a semantic duplicate of any idea created in the
 * last 30 days across BOTH ring_cam_ideas and body_cam_ideas tables.
 *
 * Considers an idea a duplicate if Claude returns similarity = 'high'.
 *
 * @param newIdea  The candidate idea to check.
 * @param format   The format of the candidate idea (ring_cam or body_cam).
 */
export async function checkDuplicate(
  newIdea: { title: string; scenario: string; category: string },
  format: 'ring_cam' | 'body_cam',
): Promise<DuplicateCheckResult> {
  logger.info('Dedup: checking candidate', { title: newIdea.title, format });

  // Fetch recent ideas from both tables for cross-format dedup
  const recentIdeas = await getAllRecentIdeas(30);

  if (recentIdeas.length === 0) {
    logger.info('Dedup: no recent ideas — skipping similarity check');
    return {
      isDuplicate: false,
      similarity: 'none',
      reason: 'No recent ideas found in the last 30 days.',
    };
  }

  // Build a compact summary of recent ideas to fit in the prompt
  // Limit to 50 most recent to keep token count reasonable
  const summaryItems = recentIdeas.slice(0, 50).map((idea, i) => {
    const source = idea.idea_source;
    return `${i + 1}. [${source}] ${idea.title} — ${idea.scenario.slice(0, 120)}`;
  });

  const prompt =
    `You are a content deduplication engine for a viral security-camera video channel.\n\n` +
    `CANDIDATE IDEA:\n` +
    `Title: "${newIdea.title}"\n` +
    `Category: ${newIdea.category}\n` +
    `Scenario: ${newIdea.scenario}\n\n` +
    `RECENT IDEAS (last 30 days):\n${summaryItems.join('\n')}\n\n` +
    `Evaluate the SEMANTIC similarity of the candidate to the recent ideas.\n` +
    `Consider: same core scenario, same twist, same setting + creature combination, or same visual punchline.\n` +
    `Different settings with the same base concept = medium similarity.\n` +
    `Nearly identical scenario or visual hook = high similarity.\n\n` +
    `Respond with this exact JSON format (no markdown, no explanation):\n` +
    `{\n` +
    `  "similarity": "<none|low|medium|high>",\n` +
    `  "similar_to": "<title of most similar idea, or null>",\n` +
    `  "reason": "<one sentence explanation>"\n` +
    `}`;

  let result: DuplicateCheckResult;

  try {
    const response = await generateCompletion(prompt, undefined, 300);

    // Parse JSON from response
    const clean = response.text.replace(/```(?:json)?/g, '').trim();
    const jsonStart = clean.indexOf('{');
    const jsonEnd = clean.lastIndexOf('}');

    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('No JSON object in response');
    }

    const parsed = JSON.parse(clean.slice(jsonStart, jsonEnd + 1)) as {
      similarity?: string;
      similar_to?: string | null;
      reason?: string;
    };

    const similarity = (['none', 'low', 'medium', 'high'].includes(parsed.similarity ?? '')
      ? parsed.similarity
      : 'none') as DuplicateCheckResult['similarity'];

    result = {
      isDuplicate: similarity === 'high',
      similarity,
      similarTo:   parsed.similar_to ?? undefined,
      reason:      parsed.reason ?? 'No reason provided',
    };
  } catch (err) {
    // On Claude failure: conservatively allow the idea through (don't block on dedup error)
    logger.warn('Dedup: Claude call failed — allowing idea through', { err });
    result = {
      isDuplicate: false,
      similarity: 'none',
      reason: `Dedup check skipped due to API error: ${String(err)}`,
    };
  }

  logger.info('Dedup: result', {
    title: newIdea.title,
    isDuplicate: result.isDuplicate,
    similarity: result.similarity,
    similarTo: result.similarTo,
  });

  return result;
}

// ── Category weights ──────────────────────────────────────────────────────────

/**
 * Compute inverse-frequency category weights for the given format.
 *
 * Categories with fewer recent produced ideas get higher weight so the ideator
 * is nudged toward under-represented territory.
 *
 * @param format  'ring_cam' or 'body_cam'
 * @returns  Map of category → weight (values sum to 1.0)
 */
export async function getCategoryWeights(
  format: 'ring_cam' | 'body_cam',
): Promise<Record<string, number>> {
  const categories = format === 'ring_cam'
    ? [...RING_CAM_CATEGORIES]
    : [...BODY_CAM_CATEGORIES];

  // Fetch 14-day category counts
  const distribution = await getCategoryDistribution(format, 14);
  const countMap = new Map<string, number>(distribution.map((d) => [d.category, d.count]));

  // Assign inverse frequency scores (categories with 0 count get max weight)
  const maxCount = Math.max(...Array.from(countMap.values()), 1);

  const rawWeights: Record<string, number> = {};
  for (const cat of categories) {
    const count = countMap.get(cat) ?? 0;
    // Inverse frequency: higher count → lower weight
    rawWeights[cat] = (maxCount - count + 1);
  }

  // Normalise to sum to 1.0
  const total = Object.values(rawWeights).reduce((s, v) => s + v, 0);
  const weights: Record<string, number> = {};
  for (const [cat, raw] of Object.entries(rawWeights)) {
    weights[cat] = raw / total;
  }

  logger.info('Dedup: category weights computed', { format, weights });
  return weights;
}
