/**
 * Characters module — barrel export.
 *
 * Re-exports the character sheet loader (YAML → Zod → cache → DB sync)
 * and the canonical pose taxonomy.
 */
export {
  CharacterSheetSchema,
  type CharacterSheet,
  loadSheet,
  clearSheetCache,
  syncSheetToDb,
  getSheetSummaryForPrompt,
  getVisualDirectionForPrompt,
} from './sheet-loader.js';

export {
  CANONICAL_POSES,
  type PoseTag,
  POSE_FALLBACK_ORDER,
  isPoseTag,
  findBestPose,
  parsePoseFromFilename,
} from './poses.js';
