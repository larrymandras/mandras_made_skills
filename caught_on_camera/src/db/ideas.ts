/**
 * Ideas DB operations — ring cam and body cam idea queue management.
 *
 * Provides read / write helpers for both ideas tables. The caller picks the
 * highest-scoring pending idea, marks it in-production, and later marks it
 * produced once the video pipeline completes.
 */
import { dbInsert, dbSelect, dbUpdate, dbSelectFiltered } from './client.js';
import { logger } from '../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IdeaStatus = 'pending' | 'in_production' | 'produced' | 'disabled';
export type IdeaSource = 'ring_cam' | 'body_cam';

export type RingCamCategory =
  | 'animals'
  | 'paranormal'
  | 'delivery'
  | 'weather'
  | 'wholesome'
  | 'fails'
  | 'night_shift';

export type BodyCamCategory =
  | 'encounter'
  | 'pursuit'
  | 'discovery'
  | 'weather_nature'
  | 'night_ops'
  | 'response'
  | 'dashcam_chaos';

export type CamSubType = 'police_security' | 'hiker_trail' | 'dashcam' | 'helmet_action';

export interface RingCamIdea {
  id: string;
  title: string;
  hook: string;
  scenario: string;
  category: RingCamCategory;
  camera_position: string;
  time_of_day: string;
  audio_notes: string | null;
  virality_score: number;
  virality_elements: string[];
  format_type: 'single' | 'compilation';
  compilation_theme: string | null;
  caption: string;
  hashtags: string[];
  status: IdeaStatus;
  created_at: string;
}

export interface BodyCamIdea {
  id: string;
  title: string;
  hook: string;
  scenario: string;
  category: BodyCamCategory;
  cam_sub_type: CamSubType;
  movement_notes: string | null;
  time_of_day: string;
  audio_notes: string | null;
  virality_score: number;
  virality_elements: string[];
  format_type: 'single' | 'compilation';
  compilation_theme: string | null;
  caption: string;
  hashtags: string[];
  status: IdeaStatus;
  created_at: string;
}

export type NewRingCamIdea = Omit<RingCamIdea, 'id' | 'status' | 'created_at'>;
export type NewBodyCamIdea = Omit<BodyCamIdea, 'id' | 'status' | 'created_at'>;

export interface CategoryCount {
  category: string;
  count: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ─── Top-idea selection ───────────────────────────────────────────────────────

/**
 * Returns the single pending ring_cam idea with the highest virality_score.
 * Returns null if the queue is empty.
 */
export async function getTopRingCamIdea(): Promise<RingCamIdea | null> {
  // TODO: switch to dbSelectFiltered once Supabase ordering API is abstracted
  const rows = await dbSelectFiltered('ring_cam_ideas', (q) =>
    q.eq('status', 'pending').order('virality_score', { ascending: false }).limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  logger.info('Selected top ring_cam idea', { id: row['id'], score: row['virality_score'] });
  return row as unknown as RingCamIdea;
}

/**
 * Returns the single pending body_cam idea with the highest virality_score.
 * Returns null if the queue is empty.
 */
export async function getTopBodyCamIdea(): Promise<BodyCamIdea | null> {
  // TODO: switch to dbSelectFiltered once Supabase ordering API is abstracted
  const rows = await dbSelectFiltered('body_cam_ideas', (q) =>
    q.eq('status', 'pending').order('virality_score', { ascending: false }).limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  logger.info('Selected top body_cam idea', {
    id: row['id'],
    score: row['virality_score'],
    sub_type: row['cam_sub_type'],
  });
  return row as unknown as BodyCamIdea;
}

// ─── Batch insert ─────────────────────────────────────────────────────────────

/** Batch-inserts an array of new ring_cam ideas. Skips empty arrays gracefully. */
export async function insertRingCamIdeas(ideas: NewRingCamIdea[]): Promise<void> {
  if (!ideas.length) return;
  for (const idea of ideas) {
    await dbInsert('ring_cam_ideas', { ...idea, status: 'pending' });
  }
  logger.info(`Inserted ${ideas.length} ring_cam idea(s)`);
}

/** Batch-inserts an array of new body_cam ideas. Skips empty arrays gracefully. */
export async function insertBodyCamIdeas(ideas: NewBodyCamIdea[]): Promise<void> {
  if (!ideas.length) return;
  for (const idea of ideas) {
    await dbInsert('body_cam_ideas', { ...idea, status: 'pending' });
  }
  logger.info(`Inserted ${ideas.length} body_cam idea(s)`);
}

// ─── Recent-ideas fetch (for deduplication) ───────────────────────────────────

/**
 * Returns ring_cam ideas created within the last `days` days.
 * Used by the AI idea generator to avoid re-generating similar scenarios.
 */
export async function getRecentRingCamIdeas(days: number): Promise<RingCamIdea[]> {
  const cutoff = daysAgo(days);
  const rows = await dbSelectFiltered('ring_cam_ideas', (q) =>
    q.gte('created_at', cutoff).order('created_at', { ascending: false }),
  );
  return rows as unknown as RingCamIdea[];
}

/**
 * Returns body_cam ideas created within the last `days` days.
 * Used by the AI idea generator to avoid re-generating similar scenarios.
 */
export async function getRecentBodyCamIdeas(days: number): Promise<BodyCamIdea[]> {
  const cutoff = daysAgo(days);
  const rows = await dbSelectFiltered('body_cam_ideas', (q) =>
    q.gte('created_at', cutoff).order('created_at', { ascending: false }),
  );
  return rows as unknown as BodyCamIdea[];
}

/**
 * Returns all ideas (both formats) created within the last `days` days,
 * tagged with their source table. Used for cross-format deduplication.
 */
export async function getAllRecentIdeas(
  days: number,
): Promise<Array<(RingCamIdea | BodyCamIdea) & { idea_source: IdeaSource }>> {
  const [ring, body] = await Promise.all([
    getRecentRingCamIdeas(days),
    getRecentBodyCamIdeas(days),
  ]);

  return [
    ...ring.map((r) => ({ ...r, idea_source: 'ring_cam' as const })),
    ...body.map((b) => ({ ...b, idea_source: 'body_cam' as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

// ─── Status transitions ───────────────────────────────────────────────────────

function tableFor(source: IdeaSource): string {
  return source === 'ring_cam' ? 'ring_cam_ideas' : 'body_cam_ideas';
}

/** Marks an idea as in_production so it is not picked again concurrently. */
export async function markIdeaInProduction(id: string, source: IdeaSource): Promise<void> {
  await dbUpdate(tableFor(source), id, { status: 'in_production' });
  logger.info('Idea marked in_production', { id, source });
}

/** Marks an idea as produced after its video has been successfully assembled. */
export async function markIdeaProduced(id: string, source: IdeaSource): Promise<void> {
  await dbUpdate(tableFor(source), id, { status: 'produced' });
  logger.info('Idea marked produced', { id, source });
}

/**
 * Permanently disables an idea — it will never be picked for production.
 * Use when an idea fails gates repeatedly or violates policy.
 */
export async function disableIdea(id: string, source: IdeaSource): Promise<void> {
  await dbUpdate(tableFor(source), id, { status: 'disabled' });
  logger.warn('Idea disabled', { id, source });
}

// ─── Category distribution ────────────────────────────────────────────────────

/**
 * Returns a count breakdown of produced ideas per category for the given
 * format over the last `days` days. Used by the idea generator to bias
 * generation toward under-represented categories.
 */
export async function getCategoryDistribution(
  format: IdeaSource,
  days: number,
): Promise<CategoryCount[]> {
  const cutoff = daysAgo(days);
  const table = tableFor(format);

  // TODO: replace with a Supabase RPC or SQL function for a proper GROUP BY
  // once the Supabase client wrapper supports raw aggregation queries.
  const rows = await dbSelectFiltered(table, (q) =>
    q.eq('status', 'produced').gte('created_at', cutoff).select('category'),
  );

  const counts = new Map<string, number>();
  for (const row of rows) {
    const cat = String(row['category']);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}
