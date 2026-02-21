/**
 * Character DB operations — reference images, consistency scores, interactions.
 */
import { dbInsert, dbSelect } from './client.js';
import { CONSISTENCY } from '../config.js';

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
