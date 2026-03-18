/**
 * Unit tests for the register-references script.
 *
 * Focuses on filename parsing and pose extraction logic without
 * requiring a database connection. Uses parsePoseFromFilename from
 * the poses module, which is the same function used by the script.
 */
import { describe, it, expect } from 'vitest';
import { parsePoseFromFilename } from '../../../src/characters/poses.js';

// ---------------------------------------------------------------------------
// Filename → pose extraction (mirrors the script's usage)
// ---------------------------------------------------------------------------

describe('register-references filename parsing', () => {
  describe('canonical pose extraction from filenames', () => {
    it('extracts pose "front" from front.jpg', () => {
      expect(parsePoseFromFilename('front.jpg')).toBe('front');
    });

    it('extracts pose "three-quarter" from three-quarter.png', () => {
      expect(parsePoseFromFilename('three-quarter.png')).toBe('three-quarter');
    });

    it('returns "untagged" for a non-canonical filename', () => {
      expect(parsePoseFromFilename('my-photo.jpg')).toBe('untagged');
    });
  });

  describe('supported image extensions', () => {
    const extensions = ['.jpg', '.png', '.webp'];

    for (const ext of extensions) {
      it(`works with ${ext} extension`, () => {
        const result = parsePoseFromFilename(`front${ext}`);
        expect(result).toBe('front');
      });
    }

    it('works with .jpeg extension (canonical pose in stem)', () => {
      expect(parsePoseFromFilename('profile.jpeg')).toBe('profile');
    });
  });

  describe('edge cases for the script workflow', () => {
    it('returns "untagged" for descriptive filenames that are not canonical poses', () => {
      expect(parsePoseFromFilename('hero-shot.jpg')).toBe('untagged');
      expect(parsePoseFromFilename('reference-01.png')).toBe('untagged');
      expect(parsePoseFromFilename('yeti-happy.webp')).toBe('untagged');
    });

    it('all 8 canonical poses are extractable from simple filenames', () => {
      const poses = [
        'front',
        'three-quarter',
        'profile',
        'back',
        'action-running',
        'action-talking',
        'close-up-face',
        'environment',
      ] as const;

      for (const pose of poses) {
        expect(parsePoseFromFilename(`${pose}.png`)).toBe(pose);
      }
    });

    it('handles filenames within versioned directories (path stripping)', () => {
      expect(parsePoseFromFilename('assets/characters/yeti/v1/front.jpg')).toBe('front');
      expect(parsePoseFromFilename('v2/action-running.png')).toBe('action-running');
    });

    it('handles Windows-style paths', () => {
      expect(parsePoseFromFilename('assets\\characters\\bigfoot\\v1\\profile.png')).toBe('profile');
    });
  });
});
