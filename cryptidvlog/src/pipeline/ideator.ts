/**
 * Ideator — selects or generates a video concept.
 * Pulls from concept_injection_queue first; auto-generates via Claude if empty.
 *
 * A/B priority scoring:
 *   New archetype: +30 | Trending topic: +25 | Series opener: +20
 *   Score >= 60 makes concept A/B eligible.
 */
import { runTextAnalysis } from '../ai/claude.js';
import { dbSelect, dbUpdate } from '../db/client.js';
import { loadSheet, getSheetSummaryForPrompt } from '../characters/index.js';
import { getRandomGuest } from '../db/characters.js';
import { getRecentConceptHistory } from '../db/videos.js';
import { logger } from '../utils/logger.js';

export interface Concept {
  conceptTitle: string;
  hook: string;
  sceneCount: number;
  characterFocus: 'yeti' | 'bigfoot' | 'both';
  guestCharacter?: string;
  estimatedCost: number;
  abEligible: boolean;
  abPriorityScore: number;
  fromQueue: boolean;
  characterSheetVersions: Record<string, number>;
}

const HOOK_TYPES = [
  'cryptid-cam-fail', 'wildlife-misidentification', 'tourist-encounter',
  'investigation-gone-wrong', 'documentary-parody', 'gear-review-disaster',
];

const SETTINGS = [
  'Pacific Northwest forest', 'Appalachian Mountains', 'Scottish Highlands',
  'Siberian tundra', 'Florida swamp', 'Utah desert',
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export async function generateConcept(): Promise<Concept> {
  logger.info('Ideator: pulling concept');

  // Load character sheets upfront (needed for versions in all paths)
  const [yetiSheet, bigfootSheet] = await Promise.all([
    loadSheet('yeti'),
    loadSheet('bigfoot'),
  ]);

  const sheetVersions: Record<string, number> = {
    yeti: yetiSheet.version,
    bigfoot: bigfootSheet.version,
  };

  // -----------------------------------------------------------------------
  // Try queue first
  // -----------------------------------------------------------------------
  const queued = await dbSelect('concept_injection_queue', { status: 'pending' });
  if (queued.length > 0) {
    const item = queued[0] as Record<string, unknown>;
    logger.info('Ideator: using queued concept', { id: item['id'] });

    await dbUpdate(
      'concept_injection_queue',
      { id: item['id'] },
      { status: 'used', used_at: new Date().toISOString() },
    );

    return {
      conceptTitle: (item['concept_title'] as string) ?? 'Queued Concept',
      hook: (item['hook'] as string) ?? 'queued',
      sceneCount: (item['scene_count'] as number) ?? 3,
      characterFocus: (item['character_focus'] as Concept['characterFocus']) ?? 'both',
      estimatedCost: (item['estimated_cost'] as number) ?? 0,
      abEligible: (item['ab_eligible'] as boolean) ?? false,
      abPriorityScore: (item['ab_priority_score'] as number) ?? 0,
      fromQueue: true,
      characterSheetVersions: sheetVersions,
    };
  }

  // -----------------------------------------------------------------------
  // Auto-generate via Claude
  // -----------------------------------------------------------------------
  logger.info('Ideator: auto-generating concept');

  const [yetiSummary, bigfootSummary, recentConcepts] = await Promise.all([
    getSheetSummaryForPrompt('yeti'),
    getSheetSummaryForPrompt('bigfoot'),
    getRecentConceptHistory(50),
  ]);

  // Pick hook/setting, avoiding hooks overused in recent episodes
  const recentHooks = recentConcepts.slice(0, 10).map((c) => c.hook);
  const freshHooks = HOOK_TYPES.filter((h) => !recentHooks.includes(h));
  const hookType = pickRandom(freshHooks.length > 0 ? freshHooks : HOOK_TYPES);
  const setting = pickRandom(SETTINGS);

  // ~30% chance of including a guest character
  let guestName: string | undefined;
  let guestSummary: string | undefined;
  if (Math.random() < 0.3) {
    const guest = await getRandomGuest();
    if (guest) {
      guestName = guest['name'] as string;
      logger.info('Ideator: including guest character', { guest: guestName });
      try {
        guestSummary = await getSheetSummaryForPrompt(guestName);
      } catch (err) {
        logger.warn('Ideator: failed to load guest sheet, continuing without guest', {
          guest: guestName,
          error: (err as Error).message,
        });
        guestName = undefined;
      }
    }
  }

  const prompt = buildIdeatorPrompt(yetiSummary, bigfootSummary, hookType, setting, guestSummary, recentConcepts);

  let concept = await tryParseConceptFromClaude(prompt);

  if (!concept) {
    logger.warn('Ideator: first parse failed, retrying with simplified prompt');
    const fallbackPrompt = buildSimplifiedPrompt(hookType, setting);
    concept = await tryParseConceptFromClaude(fallbackPrompt);
  }

  if (!concept) {
    logger.warn('Ideator: both parses failed, using hardcoded fallback');
    concept = buildFallbackConcept(hookType, setting);
  }

  concept.fromQueue = false;
  concept.characterSheetVersions = sheetVersions;
  if (guestName) concept.guestCharacter = guestName;

  // Dedup safety net: reject if title is too similar to a recent concept
  if (recentConcepts.length > 0 && isTooSimilar(concept.conceptTitle, recentConcepts)) {
    logger.warn('Ideator: generated concept too similar to existing, retrying once');
    const retryPrompt = buildIdeatorPrompt(yetiSummary, bigfootSummary, pickRandom(HOOK_TYPES), pickRandom(SETTINGS), guestSummary, recentConcepts);
    const retryConcept = await tryParseConceptFromClaude(retryPrompt);
    if (retryConcept && !isTooSimilar(retryConcept.conceptTitle, recentConcepts)) {
      retryConcept.fromQueue = false;
      retryConcept.characterSheetVersions = sheetVersions;
      if (guestName) retryConcept.guestCharacter = guestName;
      return retryConcept;
    }
  }

  return concept;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildIdeatorPrompt(
  yetiSummary: string,
  bigfootSummary: string,
  hookType: string,
  setting: string,
  guestSummary?: string,
  recentConcepts?: { title: string; hook: string }[],
): string {
  const guestBlock = guestSummary
    ? `\n\n---\n\nA GUEST CHARACTER is appearing in this episode:\n\n${guestSummary}\n\nIncorporate the guest naturally into the concept. The guest should complement or contrast with the lead characters. The characterFocus still refers to LEAD characters only.`
    : '';

  const historyBlock = recentConcepts && recentConcepts.length > 0
    ? `\n\n---\n\n## Previously Created Episodes (DO NOT DUPLICATE)\nThe following concepts have already been produced. Your new concept MUST be substantially different in title, premise, and angle. Do not reuse the same jokes, scenarios, or story beats.\n\n${recentConcepts.map((c) => `- "${c.title}" (hook: ${c.hook})`).join('\n')}\n`
    : '';

  return `You are the creative ideator for a cryptid vlog channel starring two characters: Yeti and Bigfoot.

Here are their personality profiles:

---
${yetiSummary}
---

---
${bigfootSummary}
---${guestBlock}${historyBlock}

Generate a video concept using:
- Hook type: "${hookType}"
- Setting: "${setting}"

Choose the best characterFocus based on which character's personality fits the concept:
- Tech-related or gadget concepts → "yeti"
- Outdoor, nature, or survival concepts → "bigfoot"
- Buddy comedy, contrast, or duo dynamics → "both"

A/B priority scoring rules:
- New archetype (a hook type the channel hasn't done before): +30
- Trending topic (timely or culturally relevant): +25
- Series opener (could launch a multi-part series): +20
- If total score >= 60, set abEligible to true; otherwise false.

Respond with ONLY a JSON object (no markdown fences, no explanation) matching this exact shape:
{
  "conceptTitle": "string — catchy video title",
  "hook": "string — the hook type used",
  "sceneCount": number (2-6),
  "characterFocus": "yeti" | "bigfoot" | "both",
  "estimatedCost": number (0.5-5.0, in dollars),
  "abEligible": boolean,
  "abPriorityScore": number (0-100)
}`;
}

function buildSimplifiedPrompt(hookType: string, setting: string): string {
  return `Generate a short video concept for a cryptid vlog. Hook type: "${hookType}". Setting: "${setting}".
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "conceptTitle": "string",
  "hook": "${hookType}",
  "sceneCount": number (2-6),
  "characterFocus": "yeti" | "bigfoot" | "both",
  "estimatedCost": number (0.5-5.0),
  "abEligible": false,
  "abPriorityScore": 0
}`;
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

async function tryParseConceptFromClaude(prompt: string): Promise<Concept | null> {
  try {
    const raw = await runTextAnalysis(prompt, 500);

    // Strip markdown code fences if present
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    // Validate required fields
    if (
      typeof parsed['conceptTitle'] !== 'string' ||
      typeof parsed['hook'] !== 'string' ||
      typeof parsed['sceneCount'] !== 'number' ||
      !['yeti', 'bigfoot', 'both'].includes(parsed['characterFocus'] as string)
    ) {
      logger.warn('Ideator: parsed JSON missing required fields');
      return null;
    }

    return {
      conceptTitle: parsed['conceptTitle'] as string,
      hook: parsed['hook'] as string,
      sceneCount: parsed['sceneCount'] as number,
      characterFocus: parsed['characterFocus'] as Concept['characterFocus'],
      estimatedCost: (parsed['estimatedCost'] as number) ?? 1.0,
      abEligible: (parsed['abEligible'] as boolean) ?? false,
      abPriorityScore: (parsed['abPriorityScore'] as number) ?? 0,
      fromQueue: false,
      characterSheetVersions: {},
    };
  } catch (err) {
    logger.warn('Ideator: failed to parse Claude response', {
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Check if a new title is too similar to any recent concept.
 * Uses normalized word overlap — if 60%+ of significant words match, it's a dupe.
 */
function isTooSimilar(newTitle: string, recent: { title: string; hook: string }[]): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2);

  const newWords = new Set(normalize(newTitle));
  if (newWords.size === 0) return false;

  for (const existing of recent) {
    const existingWords = normalize(existing.title);
    if (existingWords.length === 0) continue;

    const overlap = existingWords.filter((w) => newWords.has(w)).length;
    const similarity = overlap / Math.max(newWords.size, existingWords.length);

    if (similarity >= 0.6) return true;
  }

  return false;
}

function buildFallbackConcept(hookType: string, setting: string): Concept {
  return {
    conceptTitle: `${hookType} in ${setting}`,
    hook: hookType,
    sceneCount: 3,
    characterFocus: 'both',
    estimatedCost: 1.0,
    abEligible: false,
    abPriorityScore: 0,
    fromQueue: false,
    characterSheetVersions: {},
  };
}
