/**
 * Video DB operations — create, update status, buffer depth.
 */
import { dbInsert, dbSelect } from './client.js';
import { logger } from '../utils/logger.js';

export async function createVideoRecord(params: {
  conceptTitle: string;
  hook: string;
  sceneCount: number;
  characterFocus: string;
  abGroup?: 'base' | 'variant_a';
  abParentId?: string;
}): Promise<Record<string, unknown>> {
  return dbInsert('videos', {
    concept_title: params.conceptTitle,
    hook: params.hook,
    scene_count: params.sceneCount,
    character_focus: params.characterFocus,
    ab_group: params.abGroup ?? null,
    ab_parent_id: params.abParentId ?? null,
    status: 'generating',
  });
}

export async function getBufferDepth(): Promise<number> {
  // Videos approved but not yet published
  const rows = await dbSelect('videos', { status: 'approved' });
  return rows.filter((r) => !(r as { published_at?: unknown }).published_at).length;
}

// NOTE: dbUpdate not yet implemented in client.ts — add it in Phase 1
export async function updateVideoStatus(
  _videoId: string,
  _status: string,
  _extra?: Record<string, unknown>,
): Promise<void> {
  // TODO: add dbUpdate() to client.ts, then implement here
  throw new Error('updateVideoStatus not implemented — add dbUpdate to client.ts first');
}
