/**
 * Unit tests for the pose taxonomy and utilities.
 */
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_POSES,
  isPoseTag,
  findBestPose,
  parsePoseFromFilename,
  POSE_FALLBACK_ORDER,
} from '../../../src/characters/poses.js';

// ---------------------------------------------------------------------------
// CANONICAL_POSES
// ---------------------------------------------------------------------------

describe('CANONICAL_POSES', () => {
  it('contains all 8 expected poses', () => {
    expect(CANONICAL_POSES).toHaveLength(8);

    const expected = [
      'front',
      'three-quarter',
      'profile',
      'back',
      'action-running',
      'action-talking',
      'close-up-face',
      'environment',
    ];

    for (const pose of expected) {
      expect(CANONICAL_POSES).toContain(pose);
    }
  });
});

// ---------------------------------------------------------------------------
// isPoseTag
// ---------------------------------------------------------------------------

describe('isPoseTag', () => {
  it('returns true for a valid pose', () => {
    expect(isPoseTag('front')).toBe(true);
  });

  it('returns true for all canonical poses', () => {
    for (const pose of CANONICAL_POSES) {
      expect(isPoseTag(pose)).toBe(true);
    }
  });

  it('returns false for an invalid string', () => {
    expect(isPoseTag('invalid')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isPoseTag('')).toBe(false);
  });

  it('returns false for a near-miss', () => {
    expect(isPoseTag('Front')).toBe(false); // case-sensitive
    expect(isPoseTag('three_quarter')).toBe(false); // wrong separator
  });
});

// ---------------------------------------------------------------------------
// findBestPose
// ---------------------------------------------------------------------------

describe('findBestPose', () => {
  it('returns exact match when the target is available', () => {
    const result = findBestPose('front', ['front', 'profile']);
    expect(result).toEqual({ pose: 'front', exact: true });
  });

  it('returns fallback with exact: false when exact match is missing', () => {
    // profile falls back to three-quarter, then front
    const result = findBestPose('profile', ['front', 'three-quarter']);
    expect(result).not.toBeNull();
    expect(result!.exact).toBe(false);
    // Should pick three-quarter first (it's earlier in the fallback order)
    expect(result!.pose).toBe('three-quarter');
  });

  it('returns null when no poses are available', () => {
    const result = findBestPose('back', []);
    expect(result).toBeNull();
  });

  it('returns appropriate fallback for action-running', () => {
    // action-running fallback order: action-talking, three-quarter, front
    const result = findBestPose('action-running', ['front', 'action-talking']);
    expect(result).not.toBeNull();
    expect(result!.exact).toBe(false);
    // action-talking comes before front in the fallback chain
    expect(result!.pose).toBe('action-talking');
  });

  it('returns front as last-resort fallback for environment', () => {
    // environment fallback order: three-quarter, front
    const result = findBestPose('environment', ['front']);
    expect(result).not.toBeNull();
    expect(result!.exact).toBe(false);
    expect(result!.pose).toBe('front');
  });

  it('returns null when none of the fallbacks are available', () => {
    // front only falls back to three-quarter
    const result = findBestPose('front', ['back', 'environment']);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POSE_FALLBACK_ORDER
// ---------------------------------------------------------------------------

describe('POSE_FALLBACK_ORDER', () => {
  it('has an entry for every canonical pose', () => {
    for (const pose of CANONICAL_POSES) {
      expect(POSE_FALLBACK_ORDER).toHaveProperty(pose);
    }
  });
});

// ---------------------------------------------------------------------------
// parsePoseFromFilename
// ---------------------------------------------------------------------------

describe('parsePoseFromFilename', () => {
  it('extracts "front" from front.jpg', () => {
    expect(parsePoseFromFilename('front.jpg')).toBe('front');
  });

  it('extracts "three-quarter" from three-quarter.png', () => {
    expect(parsePoseFromFilename('three-quarter.png')).toBe('three-quarter');
  });

  it('extracts "close-up-face" from close-up-face.webp', () => {
    expect(parsePoseFromFilename('close-up-face.webp')).toBe('close-up-face');
  });

  it('returns "untagged" for a non-canonical filename', () => {
    expect(parsePoseFromFilename('random-photo.jpg')).toBe('untagged');
  });

  it('extracts "action-running" from action-running.png', () => {
    expect(parsePoseFromFilename('action-running.png')).toBe('action-running');
  });

  it('extracts "profile" from profile.jpg', () => {
    expect(parsePoseFromFilename('profile.jpg')).toBe('profile');
  });

  it('extracts "back" from back.png', () => {
    expect(parsePoseFromFilename('back.png')).toBe('back');
  });

  it('extracts "environment" from environment.webp', () => {
    expect(parsePoseFromFilename('environment.webp')).toBe('environment');
  });

  it('extracts "action-talking" from action-talking.jpg', () => {
    expect(parsePoseFromFilename('action-talking.jpg')).toBe('action-talking');
  });

  it('handles filenames with directory paths', () => {
    expect(parsePoseFromFilename('assets/characters/yeti/v1/front.jpg')).toBe('front');
  });

  it('returns "untagged" for filenames with extra text before the pose', () => {
    expect(parsePoseFromFilename('yeti-front.jpg')).toBe('untagged');
  });
});
