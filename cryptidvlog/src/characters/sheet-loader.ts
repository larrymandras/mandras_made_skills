/**
 * Character sheet loader — reads YAML character sheets, validates with Zod,
 * caches in memory, syncs to the database, and produces prompt-ready summaries.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { dbSelect, dbUpdate } from '../db/client.js';

// ---------------------------------------------------------------------------
// Project root (two levels up from src/characters/)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const FurSchema = z.object({
  color: z.string(),
  texture: z.string(),
  seasonal_variation: z.string(),
});

const FaceSchema = z.object({
  eyes: z.string(),
  brow: z.string(),
  nose: z.string(),
  mouth: z.string(),
  teeth: z.string(),
  expression_default: z.string(),
});

const PhysicalSchema = z.object({
  height_ft: z.tuple([z.number(), z.number()]),
  build: z.string(),
  fur: FurSchema,
  face: FaceSchema,
  hands: z.string(),
  feet: z.string(),
  distinguishing_marks: z.array(z.string()),
  clothing: z.array(z.string()),
});

const VoiceSchema = z.object({
  range_hz: z.tuple([z.number(), z.number()]),
  timbre: z.string(),
  speech_patterns: z.array(z.string()),
  catchphrases: z.array(z.string()),
  verbal_tics: z.array(z.string()),
  never_say: z.array(z.string()),
});

const PersonalitySchema = z.object({
  core_traits: z.array(z.string()),
  fears: z.array(z.string()),
  loves: z.array(z.string()),
  quirks: z.array(z.string()),
});

const RelationshipEntrySchema = z.object({
  dynamic: z.string(),
  tension_source: z.string(),
  running_jokes: z.array(z.string()),
}).catchall(z.string());

const RelationshipsSchema = z.record(z.string(), RelationshipEntrySchema);

const BackstorySchema = z.object({
  origin: z.string(),
  arc: z.string(),
  secrets: z.array(z.string()),
});

const ConstraintsSchema = z.object({
  never_do: z.array(z.string()),
  always: z.array(z.string()),
});

const VisualDirectionSchema = z.object({
  color_palette: z.array(z.string()),
  lighting_notes: z.string(),
  camera_angles_preferred: z.array(z.string()),
  environment_associations: z.array(z.string()),
  pose_personality_map: z.record(z.string(), z.string()),
});

export const CharacterSheetSchema = z.object({
  version: z.number().int().positive(),
  name: z.string(),
  species: z.string(),
  physical: PhysicalSchema,
  voice: VoiceSchema,
  personality: PersonalitySchema,
  relationships: RelationshipsSchema,
  backstory: BackstorySchema,
  constraints: ConstraintsSchema,
  visual_direction: VisualDirectionSchema,
});

export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 300_000; // 5 minutes

const sheetCache = new Map<string, { sheet: CharacterSheet; loadedAt: number }>();

/** Clear the entire sheet cache (useful for tests). */
export function clearSheetCache(): void {
  sheetCache.clear();
}

// ---------------------------------------------------------------------------
// loadSheet
// ---------------------------------------------------------------------------

/**
 * Load and validate a character sheet from disk.
 *
 * Reads `assets/characters/{name}/sheet.yaml` relative to the project root,
 * parses it as YAML, validates with the Zod schema, and caches the result
 * for 5 minutes.
 */
export async function loadSheet(name: string): Promise<CharacterSheet> {
  const cached = sheetCache.get(name);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.sheet;
  }

  const filePath = resolve(PROJECT_ROOT, 'assets', 'characters', name, 'sheet.yaml');
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Failed to read character sheet for "${name}" at ${filePath}: ${(err as Error).message}`,
    );
  }

  const parsed: unknown = parse(raw);

  const result = CharacterSheetSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Character sheet validation failed for "${name}":\n${issues}`,
    );
  }

  sheetCache.set(name, { sheet: result.data, loadedAt: Date.now() });
  return result.data;
}

// ---------------------------------------------------------------------------
// syncSheetToDb
// ---------------------------------------------------------------------------

/**
 * Sync a character sheet to the database if the on-disk version is newer.
 *
 * Compares sheet.version to the stored sheet_version in the characters table.
 * If stale (or missing), writes the full YAML string, version, and timestamp.
 */
export async function syncSheetToDb(name: string): Promise<void> {
  const sheet = await loadSheet(name);

  const rows = await dbSelect('characters', { name: sheet.name });
  if (rows.length === 0) {
    throw new Error(`Character "${sheet.name}" not found in the characters table.`);
  }

  const dbVersion = (rows[0] as { sheet_version?: number }).sheet_version ?? 0;
  if (sheet.version <= dbVersion) return; // already up to date

  const filePath = resolve(PROJECT_ROOT, 'assets', 'characters', name, 'sheet.yaml');
  const rawYaml = await readFile(filePath, 'utf-8');

  await dbUpdate(
    'characters',
    { name: sheet.name },
    {
      sheet_yaml: rawYaml,
      sheet_version: sheet.version,
      sheet_updated_at: new Date().toISOString(),
    },
  );
}

// ---------------------------------------------------------------------------
// getSheetSummaryForPrompt
// ---------------------------------------------------------------------------

/**
 * Return a flattened text summary of the character sheet, suitable for
 * injection into an LLM prompt. Excludes visual_direction (producer-only).
 */
export async function getSheetSummaryForPrompt(name: string): Promise<string> {
  const s = await loadSheet(name);
  const lines: string[] = [];

  lines.push(`# ${s.name} — Character Sheet`);
  lines.push(`Species: ${s.species}`);
  lines.push('');

  // Physical
  lines.push('## Physical Description');
  lines.push(`Height: ${s.physical.height_ft[0]}–${s.physical.height_ft[1]} ft`);
  lines.push(`Build: ${s.physical.build}`);
  lines.push(`Fur: ${s.physical.fur.color} — ${s.physical.fur.texture}`);
  lines.push(`Seasonal variation: ${s.physical.fur.seasonal_variation}`);
  lines.push(`Eyes: ${s.physical.face.eyes}`);
  lines.push(`Brow: ${s.physical.face.brow}`);
  lines.push(`Nose: ${s.physical.face.nose}`);
  lines.push(`Mouth: ${s.physical.face.mouth}`);
  lines.push(`Teeth: ${s.physical.face.teeth}`);
  lines.push(`Default expression: ${s.physical.face.expression_default}`);
  lines.push(`Hands: ${s.physical.hands}`);
  lines.push(`Feet: ${s.physical.feet}`);
  lines.push(`Distinguishing marks: ${s.physical.distinguishing_marks.join('; ')}`);
  lines.push(`Clothing: ${s.physical.clothing.join('; ')}`);
  lines.push('');

  // Voice
  lines.push('## Voice & Speech');
  lines.push(`Timbre: ${s.voice.timbre}`);
  lines.push(`Speech patterns:`);
  for (const p of s.voice.speech_patterns) lines.push(`  - ${p}`);
  lines.push(`Catchphrases:`);
  for (const c of s.voice.catchphrases) lines.push(`  - "${c}"`);
  lines.push(`Verbal tics:`);
  for (const t of s.voice.verbal_tics) lines.push(`  - ${t}`);
  lines.push('');

  // Personality
  lines.push('## Personality');
  lines.push('Core traits:');
  for (const t of s.personality.core_traits) lines.push(`  - ${t}`);
  lines.push('Fears:');
  for (const f of s.personality.fears) lines.push(`  - ${f}`);
  lines.push('Loves:');
  for (const l of s.personality.loves) lines.push(`  - ${l}`);
  lines.push('Quirks:');
  for (const q of s.personality.quirks) lines.push(`  - ${q}`);
  lines.push('');

  // Relationships
  lines.push('## Relationships');
  for (const [partner, rel] of Object.entries(s.relationships)) {
    lines.push(`### ${partner}`);
    lines.push(`Dynamic: ${rel.dynamic}`);
    // Include any character-specific "sees as" keys
    for (const [key, val] of Object.entries(rel)) {
      if (['dynamic', 'tension_source', 'running_jokes'].includes(key)) continue;
      lines.push(`${key.replace(/_/g, ' ')}: ${val}`);
    }
    lines.push(`Tension source: ${rel.tension_source}`);
    lines.push('Running jokes:');
    for (const j of rel.running_jokes) lines.push(`  - ${j}`);
  }
  lines.push('');

  // Backstory
  lines.push('## Backstory');
  lines.push(`Origin: ${s.backstory.origin}`);
  lines.push(`Arc: ${s.backstory.arc}`);
  lines.push('Secrets:');
  for (const sec of s.backstory.secrets) lines.push(`  - ${sec}`);
  lines.push('');

  // Constraints
  lines.push('## Constraints');
  lines.push('NEVER do:');
  for (const n of s.constraints.never_do) lines.push(`  - ${n}`);
  lines.push('ALWAYS:');
  for (const a of s.constraints.always) lines.push(`  - ${a}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// getVisualDirectionForPrompt
// ---------------------------------------------------------------------------

/**
 * Return the visual_direction block formatted for video generation prompts.
 */
export async function getVisualDirectionForPrompt(name: string): Promise<string> {
  const s = await loadSheet(name);
  const v = s.visual_direction;
  const lines: string[] = [];

  lines.push(`# ${s.name} — Visual Direction`);
  lines.push('');
  lines.push(`Color palette: ${v.color_palette.join(', ')}`);
  lines.push('');
  lines.push(`Lighting: ${v.lighting_notes}`);
  lines.push('');
  lines.push('Preferred camera angles:');
  for (const a of v.camera_angles_preferred) lines.push(`  - ${a}`);
  lines.push('');
  lines.push('Environment associations:');
  for (const e of v.environment_associations) lines.push(`  - ${e}`);
  lines.push('');
  lines.push('Pose personality map:');
  for (const [pose, desc] of Object.entries(v.pose_personality_map)) {
    lines.push(`  ${pose}: ${desc}`);
  }

  return lines.join('\n');
}
