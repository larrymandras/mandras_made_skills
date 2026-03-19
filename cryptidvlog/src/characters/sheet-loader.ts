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
  tension_source: z.string().optional(),
  running_jokes: z.array(z.string()).optional(),
}).catchall(z.string());

const RelationshipsSchema = z.record(z.string(), RelationshipEntrySchema);

const BackstorySchema = z.object({
  origin: z.string(),
  arc: z.string(),
  secrets: z.array(z.string()).optional(),
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

// ---------------------------------------------------------------------------
// Guest character schemas (lighter structure)
// ---------------------------------------------------------------------------

const GuestPhysicalSchema = z.object({
  height: z.string().optional(),
  build: z.string(),
  hair: z.string().optional(),
  eyes: z.string().optional(),
  skin: z.string().optional(),
  clothing: z.array(z.string()).optional(),
  distinguishing_marks: z.array(z.string()).optional(),
  accessories: z.array(z.string()).optional(),
}).passthrough();

const GuestVoiceSchema = z.object({
  timbre: z.string(),
  speech_patterns: z.array(z.string()),
  catchphrases: z.array(z.string()),
  never_say: z.array(z.string()).optional(),
}).passthrough();

const GuestPersonalitySchema = z.object({
  core_traits: z.array(z.string()),
  quirks: z.array(z.string()),
}).passthrough();

const GuestBackstorySchema = z.object({
  origin: z.string(),
}).passthrough();

const GuestVisualDirectionSchema = z.object({
  color_palette: z.array(z.string()),
  lighting_notes: z.string(),
  environment_associations: z.array(z.string()),
}).passthrough();

const GuestCharacterSheetSchema = z.object({
  version: z.number().int().positive(),
  name: z.string(),
  species: z.string(),
  role: z.literal('guest'),
  display_name: z.string().optional(),
  archetype: z.string().optional(),
  signature_behaviors: z.array(z.string()).optional(),
  physical: GuestPhysicalSchema,
  voice: GuestVoiceSchema,
  personality: GuestPersonalitySchema,
  relationships: RelationshipsSchema,
  backstory: GuestBackstorySchema,
  constraints: ConstraintsSchema,
  visual_direction: GuestVisualDirectionSchema,
});

// ---------------------------------------------------------------------------
// Lead character schema (full structure)
// ---------------------------------------------------------------------------

export const CharacterSheetSchema = z.object({
  version: z.number().int().positive(),
  name: z.string(),
  species: z.string(),
  role: z.enum(['lead', 'guest']).optional().default('lead'),
  display_name: z.string().optional(),
  archetype: z.string().optional(),
  signature_behaviors: z.array(z.string()).optional(),
  physical: PhysicalSchema,
  voice: VoiceSchema,
  personality: PersonalitySchema,
  relationships: RelationshipsSchema,
  backstory: BackstorySchema,
  constraints: ConstraintsSchema,
  visual_direction: VisualDirectionSchema,
});

export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;
export type GuestCharacterSheet = z.infer<typeof GuestCharacterSheetSchema>;
export type AnyCharacterSheet = CharacterSheet | GuestCharacterSheet;

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 300_000; // 5 minutes

const sheetCache = new Map<string, { sheet: AnyCharacterSheet; loadedAt: number }>();

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
export async function loadSheet(name: string): Promise<AnyCharacterSheet> {
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

  // Try lead schema first, then guest schema
  const leadResult = CharacterSheetSchema.safeParse(parsed);
  if (leadResult.success) {
    sheetCache.set(name, { sheet: leadResult.data, loadedAt: Date.now() });
    return leadResult.data;
  }

  const guestResult = GuestCharacterSheetSchema.safeParse(parsed);
  if (guestResult.success) {
    sheetCache.set(name, { sheet: guestResult.data, loadedAt: Date.now() });
    return guestResult.data;
  }

  // Both failed — report guest errors if role is 'guest', lead errors otherwise
  const roleHint = (parsed as Record<string, unknown>)?.role;
  const errorResult = roleHint === 'guest' ? guestResult : leadResult;
  const issues = errorResult.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(
    `Character sheet validation failed for "${name}":\n${issues}`,
  );
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

  const displayLabel = s.display_name ?? s.name;
  lines.push(`# ${displayLabel} — Character Sheet`);
  lines.push(`Species: ${s.species}`);
  if (s.role === 'guest') lines.push(`Role: Guest Character`);
  if (s.archetype) lines.push(`Archetype: ${s.archetype}`);
  lines.push('');

  // Physical — handle both lead (nested) and guest (flat) schemas
  lines.push('## Physical Description');
  if ('height_ft' in s.physical) {
    // Lead character schema
    const p = s.physical as z.infer<typeof PhysicalSchema>;
    lines.push(`Height: ${p.height_ft[0]}–${p.height_ft[1]} ft`);
    lines.push(`Build: ${p.build}`);
    lines.push(`Fur: ${p.fur.color} — ${p.fur.texture}`);
    lines.push(`Seasonal variation: ${p.fur.seasonal_variation}`);
    lines.push(`Eyes: ${p.face.eyes}`);
    lines.push(`Brow: ${p.face.brow}`);
    lines.push(`Nose: ${p.face.nose}`);
    lines.push(`Mouth: ${p.face.mouth}`);
    lines.push(`Teeth: ${p.face.teeth}`);
    lines.push(`Default expression: ${p.face.expression_default}`);
    lines.push(`Hands: ${p.hands}`);
    lines.push(`Feet: ${p.feet}`);
    lines.push(`Distinguishing marks: ${p.distinguishing_marks.join('; ')}`);
    lines.push(`Clothing: ${p.clothing.join('; ')}`);
  } else {
    // Guest character schema
    const p = s.physical as z.infer<typeof GuestPhysicalSchema>;
    if (p.height) lines.push(`Height: ${p.height}`);
    lines.push(`Build: ${p.build}`);
    if (p.hair) lines.push(`Hair: ${p.hair}`);
    if (p.eyes) lines.push(`Eyes: ${p.eyes}`);
    if (p.skin) lines.push(`Skin: ${p.skin}`);
    if (p.clothing) lines.push(`Clothing: ${p.clothing.join('; ')}`);
    if (p.distinguishing_marks) lines.push(`Distinguishing marks: ${p.distinguishing_marks.join('; ')}`);
    if (p.accessories) lines.push(`Accessories: ${p.accessories.join('; ')}`);
  }
  lines.push('');

  // Voice — handle both schemas
  lines.push('## Voice & Speech');
  lines.push(`Timbre: ${s.voice.timbre}`);
  lines.push(`Speech patterns:`);
  for (const p of s.voice.speech_patterns) lines.push(`  - ${p}`);
  lines.push(`Catchphrases:`);
  for (const c of s.voice.catchphrases) lines.push(`  - "${c}"`);
  if ('verbal_tics' in s.voice && Array.isArray(s.voice.verbal_tics) && s.voice.verbal_tics.length > 0) {
    lines.push(`Verbal tics:`);
    for (const t of s.voice.verbal_tics) lines.push(`  - ${t}`);
  }
  lines.push('');

  // Personality
  lines.push('## Personality');
  lines.push('Core traits:');
  for (const t of s.personality.core_traits) lines.push(`  - ${t}`);
  if ('fears' in s.personality && Array.isArray(s.personality.fears)) {
    lines.push('Fears:');
    for (const f of s.personality.fears) lines.push(`  - ${f}`);
  }
  if ('loves' in s.personality && Array.isArray(s.personality.loves)) {
    lines.push('Loves:');
    for (const l of s.personality.loves) lines.push(`  - ${l}`);
  }
  lines.push('Quirks:');
  for (const q of s.personality.quirks) lines.push(`  - ${q}`);
  lines.push('');

  // Signature behaviors (guest characters)
  if (s.signature_behaviors && s.signature_behaviors.length > 0) {
    lines.push('## Signature Behaviors');
    for (const b of s.signature_behaviors) lines.push(`  - ${b}`);
    lines.push('');
  }

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
    if (rel.tension_source) lines.push(`Tension source: ${rel.tension_source}`);
    if (rel.running_jokes && rel.running_jokes.length > 0) {
      lines.push('Running jokes:');
      for (const j of rel.running_jokes) lines.push(`  - ${j}`);
    }
  }
  lines.push('');

  // Backstory
  lines.push('## Backstory');
  lines.push(`Origin: ${s.backstory.origin}`);
  lines.push(`Arc: ${s.backstory.arc}`);
  if (s.backstory.secrets && s.backstory.secrets.length > 0) {
    lines.push('Secrets:');
    for (const sec of s.backstory.secrets) lines.push(`  - ${sec}`);
  }
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

  if ('camera_angles_preferred' in v && Array.isArray(v.camera_angles_preferred)) {
    lines.push('Preferred camera angles:');
    for (const a of v.camera_angles_preferred) lines.push(`  - ${a}`);
    lines.push('');
  }

  lines.push('Environment associations:');
  for (const e of v.environment_associations) lines.push(`  - ${e}`);

  if ('pose_personality_map' in v && typeof v.pose_personality_map === 'object' && v.pose_personality_map) {
    lines.push('');
    lines.push('Pose personality map:');
    for (const [pose, desc] of Object.entries(v.pose_personality_map as Record<string, string>)) {
      lines.push(`  ${pose}: ${desc}`);
    }
  }

  return lines.join('\n');
}
