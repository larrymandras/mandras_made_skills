/**
 * Unit tests for the character sheet loader.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  loadSheet,
  clearSheetCache,
  getSheetSummaryForPrompt,
  getVisualDirectionForPrompt,
  CharacterSheetSchema,
} from '../../../src/characters/sheet-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Setup — clear cache before each test to avoid cross-test contamination
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearSheetCache();
});

// ---------------------------------------------------------------------------
// loadSheet
// ---------------------------------------------------------------------------

describe('loadSheet', () => {
  it('loads the yeti sheet with expected fields', async () => {
    const sheet = await loadSheet('yeti');

    expect(sheet.name).toBe('Yeti');
    expect(sheet.species).toBe('Himalayan Yeti (Migoi)');
    expect(sheet.version).toBe(1);
    expect(sheet.physical).toBeDefined();
    expect(sheet.physical.height_ft).toEqual([8, 9]);
    expect(sheet.voice).toBeDefined();
    expect(sheet.voice.catchphrases.length).toBeGreaterThan(0);
    expect(sheet.personality).toBeDefined();
    expect(sheet.relationships).toBeDefined();
    expect(sheet.backstory).toBeDefined();
    expect(sheet.constraints).toBeDefined();
    expect(sheet.visual_direction).toBeDefined();
  });

  it('loads the bigfoot sheet with expected fields', async () => {
    const sheet = await loadSheet('bigfoot');

    expect(sheet.name).toBe('Bigfoot');
    expect(sheet.species).toBe('North American Sasquatch (Sasquahtch\'en)');
    expect(sheet.version).toBe(1);
    expect(sheet.physical.height_ft).toEqual([7, 8]);
    expect(sheet.voice).toBeDefined();
    expect(sheet.personality.core_traits.length).toBeGreaterThan(0);
  });

  it('throws on a nonexistent character', async () => {
    await expect(loadSheet('nonexistent')).rejects.toThrow(
      /Failed to read character sheet for "nonexistent"/,
    );
  });
});

// ---------------------------------------------------------------------------
// Schema validation (manual YAML parse)
// ---------------------------------------------------------------------------

describe('CharacterSheetSchema validation', () => {
  it('validates the yeti sheet.yaml against the Zod schema', async () => {
    const filePath = resolve(PROJECT_ROOT, 'assets', 'characters', 'yeti', 'sheet.yaml');
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parse(raw);

    const result = CharacterSheetSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('validates the bigfoot sheet.yaml against the Zod schema', async () => {
    const filePath = resolve(PROJECT_ROOT, 'assets', 'characters', 'bigfoot', 'sheet.yaml');
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parse(raw);

    const result = CharacterSheetSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cache behaviour
// ---------------------------------------------------------------------------

describe('sheet cache', () => {
  it('returns the same object reference on consecutive calls', async () => {
    const first = await loadSheet('yeti');
    const second = await loadSheet('yeti');

    expect(first).toBe(second); // strict reference equality
  });

  it('returns a new object after clearSheetCache()', async () => {
    const first = await loadSheet('yeti');
    clearSheetCache();
    const second = await loadSheet('yeti');

    expect(first).not.toBe(second); // different reference
    expect(first).toEqual(second); // same content
  });
});

// ---------------------------------------------------------------------------
// getSheetSummaryForPrompt
// ---------------------------------------------------------------------------

describe('getSheetSummaryForPrompt', () => {
  it('returns a string containing key character details', async () => {
    const summary = await getSheetSummaryForPrompt('yeti');

    // Should contain character name
    expect(summary).toContain('Yeti');

    // Should contain catchphrases
    expect(summary).toContain('Okay okay okay');
    expect(summary).toContain("EXACTLY what they want you to think");

    // Should contain personality traits
    expect(summary).toContain('Anxious');
    expect(summary).toContain('Conspiracy-prone');

    // Should contain section headers
    expect(summary).toContain('## Physical Description');
    expect(summary).toContain('## Voice & Speech');
    expect(summary).toContain('## Personality');
    expect(summary).toContain('## Relationships');
    expect(summary).toContain('## Backstory');
    expect(summary).toContain('## Constraints');
  });

  it('does NOT include visual_direction content', async () => {
    const summary = await getSheetSummaryForPrompt('yeti');

    // visual_direction fields should be absent
    expect(summary).not.toContain('Visual Direction');
    expect(summary).not.toContain('#E8E8F0'); // color palette hex
    expect(summary).not.toContain('Rim lighting');
    expect(summary).not.toContain('camera_angles_preferred');
    expect(summary).not.toContain('Pose personality map');
  });
});

// ---------------------------------------------------------------------------
// getVisualDirectionForPrompt
// ---------------------------------------------------------------------------

describe('getVisualDirectionForPrompt', () => {
  it('returns a string with color palette and lighting notes', async () => {
    const visual = await getVisualDirectionForPrompt('yeti');

    // Header
    expect(visual).toContain('Yeti');
    expect(visual).toContain('Visual Direction');

    // Color palette values
    expect(visual).toContain('#E8E8F0');
    expect(visual).toContain('#1A1A2E');

    // Lighting notes
    expect(visual).toContain('Cool blue-white tones');
    expect(visual).toContain('Rim lighting');

    // Camera angles
    expect(visual).toContain('Close-up on face for anxiety reactions');

    // Environment associations
    expect(visual).toContain('Cluttered cave-den');

    // Pose personality map
    expect(visual).toContain('anxious');
    expect(visual).toContain('Shoulders hunched');
  });
});
