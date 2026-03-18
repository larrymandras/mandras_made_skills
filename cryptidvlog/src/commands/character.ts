/**
 * `/cryptidvlog character` command — view or update character sheets.
 *
 * Subcommands:
 *   character <name>         — display full character sheet + reference image status
 *   character update <name>  — bump sheet version, sync to DB
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import {
  loadSheet,
  syncSheetToDb,
  clearSheetCache,
  type CharacterSheet,
} from '../characters/sheet-loader.js';
import {
  getActiveReferences,
} from '../db/characters.js';
import { dbSelect } from '../db/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function characterCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    process.stdout.write('Usage:\n');
    process.stdout.write('  cryptidvlog character <name>          — view character sheet\n');
    process.stdout.write('  cryptidvlog character update <name>   — bump version & sync\n');
    process.exit(1);
  }

  if (args[0] === 'update') {
    const name = args[1];
    if (!name) {
      process.stderr.write('Error: character name required. Usage: cryptidvlog character update <name>\n');
      process.exit(1);
    }
    await handleUpdate(name);
  } else {
    await handleView(args[0]);
  }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

async function handleView(name: string): Promise<void> {
  const sheet = await loadSheet(name);
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(`========================================`);
  lines.push(`  ${sheet.name}`);
  lines.push(`========================================`);
  lines.push(`Species:  ${sheet.species}`);
  lines.push(`Height:   ${sheet.physical.height_ft[0]}–${sheet.physical.height_ft[1]} ft`);
  lines.push(`Version:  v${sheet.version}`);
  lines.push('');

  // Physical
  lines.push('--- Physical Description ---');
  lines.push(`  Build:              ${sheet.physical.build}`);
  lines.push(`  Fur color:          ${sheet.physical.fur.color}`);
  lines.push(`  Fur texture:        ${sheet.physical.fur.texture}`);
  lines.push(`  Seasonal variation: ${sheet.physical.fur.seasonal_variation}`);
  lines.push(`  Eyes:               ${sheet.physical.face.eyes}`);
  lines.push(`  Brow:               ${sheet.physical.face.brow}`);
  lines.push(`  Nose:               ${sheet.physical.face.nose}`);
  lines.push(`  Mouth:              ${sheet.physical.face.mouth}`);
  lines.push(`  Teeth:              ${sheet.physical.face.teeth}`);
  lines.push(`  Default expression: ${sheet.physical.face.expression_default}`);
  lines.push(`  Hands:              ${sheet.physical.hands}`);
  lines.push(`  Feet:               ${sheet.physical.feet}`);
  lines.push('  Distinguishing marks:');
  for (const mark of sheet.physical.distinguishing_marks) {
    lines.push(`    - ${mark}`);
  }
  lines.push('  Clothing:');
  for (const item of sheet.physical.clothing) {
    lines.push(`    - ${item}`);
  }
  lines.push('');

  // Personality
  lines.push('--- Personality ---');
  lines.push('  Core traits:');
  for (const t of sheet.personality.core_traits) lines.push(`    - ${t}`);
  lines.push('  Fears:');
  for (const f of sheet.personality.fears) lines.push(`    - ${f}`);
  lines.push('  Loves:');
  for (const l of sheet.personality.loves) lines.push(`    - ${l}`);
  lines.push('  Quirks:');
  for (const q of sheet.personality.quirks) lines.push(`    - ${q}`);
  lines.push('');

  // Voice
  lines.push('--- Voice & Speech ---');
  lines.push(`  Range:   ${sheet.voice.range_hz[0]}–${sheet.voice.range_hz[1]} Hz`);
  lines.push(`  Timbre:  ${sheet.voice.timbre}`);
  lines.push('  Speech patterns:');
  for (const p of sheet.voice.speech_patterns) lines.push(`    - ${p}`);
  lines.push('  Catchphrases:');
  for (const c of sheet.voice.catchphrases) lines.push(`    - "${c}"`);
  lines.push('  Verbal tics:');
  for (const t of sheet.voice.verbal_tics) lines.push(`    - ${t}`);
  lines.push('  Never say:');
  for (const n of sheet.voice.never_say) lines.push(`    - ${n}`);
  lines.push('');

  // Relationships
  lines.push('--- Relationships ---');
  for (const [partner, rel] of Object.entries(sheet.relationships)) {
    lines.push(`  ${partner}:`);
    lines.push(`    Dynamic:        ${rel.dynamic}`);
    for (const [key, val] of Object.entries(rel)) {
      if (['dynamic', 'tension_source', 'running_jokes'].includes(key)) continue;
      lines.push(`    ${key.replace(/_/g, ' ')}: ${val}`);
    }
    lines.push(`    Tension source: ${rel.tension_source}`);
    lines.push('    Running jokes:');
    for (const j of rel.running_jokes) lines.push(`      - ${j}`);
  }
  lines.push('');

  // Backstory
  lines.push('--- Backstory ---');
  lines.push(`  Origin: ${sheet.backstory.origin}`);
  lines.push(`  Arc:    ${sheet.backstory.arc}`);
  lines.push('  Secrets:');
  for (const s of sheet.backstory.secrets) lines.push(`    - ${s}`);
  lines.push('');

  // Constraints
  lines.push('--- Constraints ---');
  lines.push('  NEVER do:');
  for (const n of sheet.constraints.never_do) lines.push(`    - ${n}`);
  lines.push('  ALWAYS:');
  for (const a of sheet.constraints.always) lines.push(`    - ${a}`);
  lines.push('');

  // Reference image status from DB
  lines.push('--- Reference Images ---');
  try {
    const refs = await getActiveReferences(sheet.name);
    if (refs.length === 0) {
      lines.push('  No active reference images found.');
    } else {
      // Group by pose
      const byPose = new Map<string, Record<string, unknown>[]>();
      for (const ref of refs) {
        const pose = (ref['pose'] as string) ?? 'unknown';
        if (!byPose.has(pose)) byPose.set(pose, []);
        byPose.get(pose)!.push(ref);
      }
      lines.push(`  Total active references: ${refs.length}`);
      for (const [pose, poseRefs] of byPose) {
        lines.push(`    ${pose}: ${poseRefs.length} image(s)`);
      }
    }

    // Latest consistency scores
    const scores = await dbSelect('character_consistency_scores', {
      character_name: sheet.name,
    });
    if (scores.length > 0) {
      // Sort by created_at or id descending, take latest 5
      const sorted = scores
        .sort((a, b) => {
          const aTime = String(a['created_at'] ?? '');
          const bTime = String(b['created_at'] ?? '');
          return bTime.localeCompare(aTime);
        })
        .slice(0, 5);
      lines.push('  Latest consistency scores:');
      for (const s of sorted) {
        const score = s['score'] as number;
        const sceneId = (s['scene_id'] as string) ?? '?';
        lines.push(`    - Scene ${sceneId}: ${score}/100`);
      }
    }
  } catch {
    lines.push('  (Could not fetch reference data from DB)');
  }

  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Update (bump version)
// ---------------------------------------------------------------------------

async function handleUpdate(name: string): Promise<void> {
  const filePath = resolve(PROJECT_ROOT, 'assets', 'characters', name, 'sheet.yaml');

  // Read raw YAML
  let rawYaml: string;
  try {
    rawYaml = await readFile(filePath, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `Error: Could not read sheet for "${name}" at ${filePath}: ${(err as Error).message}\n`,
    );
    process.exit(1);
  }

  const parsed = parse(rawYaml) as Record<string, unknown>;
  const oldVersion = parsed['version'] as number;
  const newVersion = oldVersion + 1;

  parsed['version'] = newVersion;

  const updatedYaml = stringify(parsed, { lineWidth: 0 });
  await writeFile(filePath, updatedYaml, 'utf-8');

  // Clear cache so loadSheet picks up the new version
  clearSheetCache();

  // Sync to DB
  await syncSheetToDb(name);

  process.stdout.write(
    `Character sheet for ${name} updated: v${oldVersion} → v${newVersion}\n`,
  );
}
