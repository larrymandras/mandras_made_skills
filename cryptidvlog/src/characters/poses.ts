/**
 * Canonical pose taxonomy for the Cryptid Vlog character reference image system.
 *
 * Defines the standard set of pose tags, fallback resolution order,
 * and utilities for matching and parsing poses from filenames.
 */

// ---------------------------------------------------------------------------
// Canonical poses
// ---------------------------------------------------------------------------

/** Every recognised pose tag, in a fixed order. */
export const CANONICAL_POSES = [
  'front',            // Full body, facing camera (default reference)
  'three-quarter',    // 3/4 view, slight turn (most natural angle)
  'profile',          // Side view (walking/transition scenes)
  'back',             // Rear view (walking-away shots)
  'action-running',   // Mid-stride, dynamic pose (chase/escape scenes)
  'action-talking',   // Gesturing, mouth open (dialogue scenes)
  'close-up-face',    // Head and shoulders only (reaction shots)
  'environment',      // Character in typical setting (establishing shots)
] as const;

/** A union of every canonical pose string. */
export type PoseTag = typeof CANONICAL_POSES[number];

// ---------------------------------------------------------------------------
// Fallback order
// ---------------------------------------------------------------------------

/**
 * When the exact pose reference isn't available, try these alternatives
 * in order. Three-quarter and front are the most versatile fallbacks.
 */
export const POSE_FALLBACK_ORDER: Record<PoseTag, PoseTag[]> = {
  'front':          ['three-quarter'],
  'three-quarter':  ['front'],
  'profile':        ['three-quarter', 'front'],
  'back':           ['three-quarter', 'front'],
  'action-running': ['action-talking', 'three-quarter', 'front'],
  'action-talking': ['action-running', 'three-quarter', 'front'],
  'close-up-face':  ['front', 'three-quarter'],
  'environment':    ['three-quarter', 'front'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard — returns true when `value` is a recognised `PoseTag`. */
export function isPoseTag(value: string): value is PoseTag {
  return (CANONICAL_POSES as readonly string[]).includes(value);
}

/**
 * Given a target pose and the poses that are actually available, return the
 * best match.
 *
 * Resolution order:
 *  1. Exact match on `targetPose`.
 *  2. Walk `POSE_FALLBACK_ORDER[targetPose]` in order.
 *  3. Return `null` if nothing matches.
 */
export function findBestPose(
  targetPose: PoseTag,
  availablePoses: PoseTag[],
): { pose: PoseTag; exact: boolean } | null {
  if (availablePoses.includes(targetPose)) {
    return { pose: targetPose, exact: true };
  }

  const fallbacks = POSE_FALLBACK_ORDER[targetPose];
  for (const fallback of fallbacks) {
    if (availablePoses.includes(fallback)) {
      return { pose: fallback, exact: false };
    }
  }

  return null;
}

/**
 * Extract a canonical pose tag from a filename.
 *
 * Supports patterns like `front.jpg`, `action-running.png`,
 * `close-up-face.webp`. The pose must appear as the full stem
 * (everything before the last `.ext`).
 *
 * Returns `'untagged'` when no canonical pose matches.
 */
export function parsePoseFromFilename(filename: string): PoseTag | 'untagged' {
  // Strip any directory component and isolate the stem before the extension.
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dotIndex = base.lastIndexOf('.');
  const stem = dotIndex > 0 ? base.slice(0, dotIndex) : base;

  if (isPoseTag(stem)) {
    return stem;
  }

  return 'untagged';
}
