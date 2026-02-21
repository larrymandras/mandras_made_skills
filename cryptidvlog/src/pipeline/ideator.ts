/**
 * Ideator — selects or generates a video concept.
 * Pulls from concept_injection_queue first; auto-generates via Claude if empty.
 *
 * A/B priority scoring:
 *   New archetype: +30 | Trending topic: +25 | Series opener: +20
 *   Score >= 60 makes concept A/B eligible.
 */
import { runTextAnalysis } from '../ai/claude.js';
import { dbSelect, dbInsert } from '../db/client.js';
import { logger } from '../utils/logger.js';

export interface Concept {
  conceptTitle: string;
  hook: string;
  sceneCount: number;
  characterFocus: 'yeti' | 'bigfoot' | 'both';
  estimatedCost: number;
  abEligible: boolean;
  abPriorityScore: number;
  fromQueue: boolean;
}

const HOOK_TYPES = [
  'cryptid-cam-fail', 'wildlife-misidentification', 'tourist-encounter',
  'investigation-gone-wrong', 'documentary-parody', 'gear-review-disaster',
];

const SETTINGS = [
  'Pacific Northwest forest', 'Appalachian Mountains', 'Scottish Highlands',
  'Siberian tundra', 'Florida swamp', 'Utah desert',
];

export async function generateConcept(): Promise<Concept> {
  logger.info('Ideator: pulling concept');

  // Try queue first
  const queued = await dbSelect('concept_injection_queue', { status: 'pending' });
  if (queued.length > 0) {
    const item = queued[0] as Record<string, unknown>;
    logger.info('Ideator: using queued concept', { id: item['id'] });
    // TODO: mark item as 'used' and return Concept from queue fields
  }

  // Auto-generate via Claude
  logger.info('Ideator: auto-generating concept');
  // TODO: send hook type + setting to Claude, parse structured concept response,
  //       calculate ab_priority_score, return Concept object
  throw new Error('Ideator not implemented');
}
