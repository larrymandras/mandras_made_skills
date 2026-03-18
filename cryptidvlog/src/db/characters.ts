/**
 * Character DB operations — reference images, consistency scores, interactions.
 */
import { dbInsert, dbSelect } from './client.js';
import { CONSISTENCY } from '../config.js';
import { findBestPose, isPoseTag, type PoseTag } from '../characters/poses.js';

export async function getCharacter(name: string): Promise<Record<string, unknown> | null> {
  const rows = await dbSelect('characters', { name });
  return rows[0] ?? null;
}

export async function saveConsistencyScore(params: {
  sceneId: string;
  characterName: string;
  score: number;
  details?: Record<string, unknown>;
  savedAsReference?: boolean;
}): Promise<void> {
  await dbInsert('character_consistency_scores', {
    scene_id: params.sceneId,
    character_name: params.characterName,
    score: params.score,
    details: params.details ?? {},
    saved_as_reference: params.savedAsReference ?? false,
  });
}

export async function getActiveReferences(
  characterName: string,
): Promise<Record<string, unknown>[]> {
  return dbSelect('character_reference_images', {
    character_name: characterName,
    is_active: true,
  });
}

export async function getActiveReferenceByPose(
  characterName: string,
  targetPose: string,
): Promise<Record<string, unknown> | null> {
  const refs = await dbSelect('character_reference_images', {
    character_name: characterName,
    is_active: true,
  });

  if (refs.length === 0) return null;

  // Collect available poses from the references
  const availablePoses = refs
    .map((r) => r['pose'] as string)
    .filter(isPoseTag);

  // If target is a valid pose tag, use findBestPose for smart fallback
  if (isPoseTag(targetPose)) {
    const match = findBestPose(targetPose, availablePoses as PoseTag[]);
    if (match) {
      return refs.find((r) => r['pose'] === match.pose) ?? null;
    }
  }

  // Fallback chain: three-quarter -> front -> any active reference
  const fallbackOrder: PoseTag[] = ['three-quarter', 'front'];
  for (const pose of fallbackOrder) {
    const found = refs.find((r) => r['pose'] === pose);
    if (found) return found;
  }

  // Last resort: return the first active reference
  return refs[0] ?? null;
}

export async function saveReferenceFrame(params: {
  characterName: string;
  filePath: string;
  consistencyScore: number;
  pose?: string;
}): Promise<void> {
  if (params.consistencyScore < CONSISTENCY.saveAbove) return;
  await dbInsert('character_reference_images', {
    character_name: params.characterName,
    source: 'auto_extracted',
    file_path: params.filePath,
    consistency_score: params.consistencyScore,
    pose: params.pose ?? null,
    is_active: true,
  });
}
