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

/**
 * Fetch recent concept titles and hooks to prevent duplicate ideas.
 * Returns the last `limit` concepts ordered by creation date.
 */
export async function getRecentConceptHistory(limit = 50): Promise<{ title: string; hook: string }[]> {
  const rows = await dbSelect('videos', {});
  // Sort by created_at descending and take the most recent
  const sorted = rows
    .sort((a, b) => {
      const aDate = new Date(a['created_at'] as string).getTime();
      const bDate = new Date(b['created_at'] as string).getTime();
      return bDate - aDate;
    })
    .slice(0, limit);

  return sorted.map((r) => ({
    title: r['concept_title'] as string,
    hook: r['hook'] as string,
  }));
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
