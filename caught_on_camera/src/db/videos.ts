/**
 * Video and scene DB operations — create records, update approval / publish
 * status, fetch the operator review queue.
 */
import { dbInsert, dbSelect, dbUpdate, dbSelectFiltered } from './client.js';
import { logger } from '../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApprovalStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'taken_down';

export type VideoFormat = 'ring_cam' | 'body_cam';
export type CamSubType = 'police_security' | 'hiker_trail' | 'dashcam' | 'helmet_action';
export type Platform = 'youtube' | 'shorts' | 'tiktok' | 'instagram';

export type SceneStatus = 'generating' | 'gate_check' | 'passed' | 'failed' | 'rejected';

export interface VideoRecord {
  id: string;
  idea_id: string;
  idea_source: VideoFormat;
  compilation_id: string | null;
  format: VideoFormat;
  cam_sub_type: CamSubType | null;
  master_16x9_url: string;
  vertical_9x16_url: string | null;
  cloudinary_public_id: string;
  title: string;
  caption: string;
  hashtags: string[];
  approval_status: ApprovalStatus;
  reject_reason: string | null;
  youtube_post_id: string | null;
  shorts_post_id: string | null;
  tiktok_post_id: string | null;
  instagram_post_id: string | null;
  crop_safe: boolean;
  gate_results: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SceneRecord {
  id: string;
  idea_id: string;
  idea_source: VideoFormat;
  format: VideoFormat;
  veo_prompt: string;
  raw_video_url: string | null;
  degraded_video_url: string | null;
  overlaid_video_url: string | null;
  cloudinary_url: string | null;
  generation_cost: number | null;
  quality_score: number | null;
  gate_pass: boolean | null;
  gate_failures: string[];
  retry_count: number;
  status: SceneStatus;
  created_at: string;
}

export type NewVideo = Omit<VideoRecord, 'id' | 'approval_status' | 'created_at' | 'updated_at'>;
export type NewScene = Omit<SceneRecord, 'id' | 'retry_count' | 'gate_pass' | 'gate_failures' | 'status' | 'created_at'>;

// ─── Video operations ─────────────────────────────────────────────────────────

/** Creates a new video record with initial approval_status = 'pending_review'. */
export async function insertVideo(video: NewVideo): Promise<VideoRecord> {
  const result = await dbInsert('videos', {
    ...video,
    approval_status: 'pending_review',
  });
  logger.info('Video record created', { id: result['id'], format: video.format });
  return result as unknown as VideoRecord;
}

/**
 * Updates the approval_status of a video.
 * When rejecting, pass an optional reason string for operator visibility.
 */
export async function updateVideoApproval(
  id: string,
  status: ApprovalStatus,
  reason?: string,
): Promise<VideoRecord> {
  const payload: Record<string, unknown> = { approval_status: status };
  if (reason) payload['reject_reason'] = reason;
  const result = await dbUpdate('videos', id, payload);
  logger.info('Video approval updated', { id, status, reason });
  return result as unknown as VideoRecord;
}

// ─── Scene operations ─────────────────────────────────────────────────────────

/** Creates a new scene record in status 'generating'. */
export async function insertScene(scene: NewScene): Promise<SceneRecord> {
  const result = await dbInsert('scenes', {
    ...scene,
    status: 'generating',
    gate_pass: null,
    gate_failures: [],
    retry_count: 0,
  });
  logger.info('Scene record created', { id: result['id'], idea_id: scene.idea_id });
  return result as unknown as SceneRecord;
}

/**
 * Updates a scene's status after a gate check pass or fail.
 * Optionally stores the full gate result payload for debugging.
 */
export async function updateSceneStatus(
  id: string,
  status: SceneStatus,
  gateResults?: {
    gate_pass: boolean;
    gate_failures?: string[];
    quality_score?: number;
  },
): Promise<SceneRecord> {
  const payload: Record<string, unknown> = { status };
  if (gateResults) {
    payload['gate_pass'] = gateResults.gate_pass;
    payload['gate_failures'] = gateResults.gate_failures ?? [];
    if (gateResults.quality_score !== undefined) {
      payload['quality_score'] = gateResults.quality_score;
    }
  }
  const result = await dbUpdate('scenes', id, payload);
  logger.info('Scene status updated', { id, status, gate_pass: gateResults?.gate_pass });
  return result as unknown as SceneRecord;
}

// ─── Buffer / publishing helpers ──────────────────────────────────────────────

/**
 * Returns all approved videos that have not yet been published to any platform.
 * Used by the scheduler to decide whether to generate more content.
 */
export async function getApprovedUnpublished(): Promise<VideoRecord[]> {
  // TODO: join with published_videos table once dbSelectFiltered supports joins,
  // to filter out videos published on at least one platform.
  const rows = await dbSelect('videos', { approval_status: 'approved' });
  return rows.filter((r) => {
    const v = r as Partial<VideoRecord>;
    return (
      !v.youtube_post_id &&
      !v.shorts_post_id &&
      !v.tiktok_post_id &&
      !v.instagram_post_id
    );
  }) as unknown as VideoRecord[];
}

/**
 * Records a successful post to a platform by storing the platform's post ID on
 * the video record, and transitions approval_status to 'published'.
 */
export async function markPublished(
  id: string,
  platform: Platform,
  postId: string,
): Promise<VideoRecord> {
  const postIdField: Record<Platform, keyof VideoRecord> = {
    youtube: 'youtube_post_id',
    shorts: 'shorts_post_id',
    tiktok: 'tiktok_post_id',
    instagram: 'instagram_post_id',
  };
  const result = await dbUpdate('videos', id, {
    [postIdField[platform]]: postId,
    approval_status: 'published',
  });
  logger.info('Video marked published', { id, platform, postId });
  return result as unknown as VideoRecord;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/** Fetches a single video by ID. Returns null if not found. */
export async function getVideoById(id: string): Promise<VideoRecord | null> {
  const rows = await dbSelect('videos', { id });
  return (rows[0] ?? null) as unknown as VideoRecord | null;
}

/**
 * Returns all videos currently in 'pending_review', ordered by creation date.
 * Drives the Telegram operator bot's approval queue.
 */
export async function getPendingReview(): Promise<VideoRecord[]> {
  const rows = await dbSelectFiltered('videos', (q) =>
    q
      .eq('approval_status', 'pending_review')
      .order('created_at', { ascending: true }),
  );
  return rows as unknown as VideoRecord[];
}
