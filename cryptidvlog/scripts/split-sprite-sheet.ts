#!/usr/bin/env tsx
/**
 * Split a 5×2 sprite sheet into 10 named pose images using ffmpeg.
 *
 * Usage:
 *   npx tsx scripts/split-sprite-sheet.ts --input <path> --name <character-name> [--version <n>]
 *   npx tsx scripts/split-sprite-sheet.ts --batch <directory> [--version <n>]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..');

/** Pose names mapped by row/col in a 5×2 grid (left-to-right, top-to-bottom). */
const POSE_GRID: readonly string[][] = [
  ['front', 'three-quarter', 'profile', 'back', 'action-running'],
  ['action-talking', 'close-up-face', 'environment', 'action-standing', 'emotion-expressive'],
] as const;

const GRID_COLS = 5;
const GRID_ROWS = 2;

const SPRITE_SHEET_PATTERN = /sprite.*sheet/i;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface SingleArgs {
  mode: 'single';
  input: string;
  name: string;
  version: number;
}

interface BatchArgs {
  mode: 'batch';
  batchDir: string;
  version: number;
}

type CliArgs = SingleArgs | BatchArgs;

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/split-sprite-sheet.ts --input <path> --name <character-name> [--version <n>]
  npx tsx scripts/split-sprite-sheet.ts --batch <directory> [--version <n>]`);
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let input: string | null = null;
  let name: string | null = null;
  let batchDir: string | null = null;
  let version = 1;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '--input' && next) {
      input = next;
      i++;
    } else if (arg === '--name' && next) {
      name = next;
      i++;
    } else if (arg === '--version' && next) {
      version = parseInt(next, 10);
      if (Number.isNaN(version) || version < 1) {
        console.error('Error: --version must be a positive integer');
        process.exit(1);
      }
      i++;
    } else if (arg === '--batch' && next) {
      batchDir = next;
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (batchDir) {
    return { mode: 'batch', batchDir, version };
  }

  if (!input) {
    console.error('Error: --input is required (or use --batch)');
    printUsage();
    process.exit(1);
  }

  if (!name) {
    console.error('Error: --name is required in single mode');
    printUsage();
    process.exit(1);
  }

  return { mode: 'single', input, name, version };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkFfmpeg(): void {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    console.error('Error: ffmpeg is not available on PATH. Please install ffmpeg.');
    process.exit(1);
  }
}

/** Get image dimensions via ffprobe. Returns [width, height]. */
function getImageDimensions(filePath: string): [number, number] {
  const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${filePath}"`;
  const output = execSync(cmd, { encoding: 'utf-8' }).trim();
  const parts = output.split('x');

  const width = parseInt(parts[0] ?? '', 10);
  const height = parseInt(parts[1] ?? '', 10);

  if (Number.isNaN(width) || Number.isNaN(height) || width <= 0 || height <= 0) {
    console.error(`Error: could not determine dimensions for ${filePath}`);
    console.error(`  ffprobe output: "${output}"`);
    process.exit(1);
  }

  return [width, height];
}

/** Convert a display name like "dr willow smith" to kebab-case "dr-willow-smith". */
function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract character name from a sprite sheet filename.
 * Strips "sprite sheet", "upscaled", extensions, etc. and kebab-cases the remainder.
 */
function extractCharacterName(filename: string): string {
  const stem = path.basename(filename, path.extname(filename));
  const cleaned = stem
    .replace(/sprite\s*sheet/gi, '')
    .replace(/upscale[d]?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return toKebabCase(cleaned);
}

// ---------------------------------------------------------------------------
// Core splitting logic
// ---------------------------------------------------------------------------

function splitSpriteSheet(inputPath: string, characterName: string, version: number): void {
  const absoluteInput = path.resolve(inputPath);

  if (!fs.existsSync(absoluteInput)) {
    console.error(`Error: input file not found: ${absoluteInput}`);
    process.exit(1);
  }

  const [width, height] = getImageDimensions(absoluteInput);
  const cellWidth = Math.floor(width / GRID_COLS);
  const cellHeight = Math.floor(height / GRID_ROWS);

  if (width % GRID_COLS !== 0 || height % GRID_ROWS !== 0) {
    console.warn(
      `Warning: image dimensions ${width}x${height} are not evenly divisible by ${GRID_COLS}x${GRID_ROWS}. ` +
        `Using cell size ${cellWidth}x${cellHeight} (some pixels may be clipped).`,
    );
  }

  const outputDir = path.join(PROJECT_ROOT, 'assets', 'characters', characterName, `v${version}`);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Splitting ${path.basename(absoluteInput)} (${width}x${height}) → ${GRID_COLS}x${GRID_ROWS} grid, cell ${cellWidth}x${cellHeight}`);

  for (let row = 0; row < GRID_ROWS; row++) {
    const poseRow = POSE_GRID[row];
    if (!poseRow) continue;

    for (let col = 0; col < GRID_COLS; col++) {
      const poseName = poseRow[col];
      if (!poseName) continue;

      const x = col * cellWidth;
      const y = row * cellHeight;
      const outFile = path.join(outputDir, `${poseName}.jpg`);

      const cmd =
        `ffmpeg -y -i "${absoluteInput}" ` +
        `-vf "crop=${cellWidth}:${cellHeight}:${x}:${y}" ` +
        `-q:v 2 "${outFile}"`;

      try {
        execSync(cmd, { stdio: 'pipe' });
        console.log(`  ✓ ${poseName}.jpg`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Failed to extract ${poseName}: ${message}`);
      }
    }
  }

  console.log(`\nSplit ${path.basename(absoluteInput)} into 10 poses for ${characterName} v${version} at ${outputDir}\n`);
}

// ---------------------------------------------------------------------------
// Batch mode
// ---------------------------------------------------------------------------

function runBatch(batchDir: string, version: number): void {
  const absoluteDir = path.resolve(batchDir);

  if (!fs.existsSync(absoluteDir)) {
    console.error(`Error: batch directory not found: ${absoluteDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(absoluteDir).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext) && SPRITE_SHEET_PATTERN.test(f);
  });

  if (files.length === 0) {
    console.log(`No sprite sheet files found in ${absoluteDir}`);
    console.log('Expected filenames matching *sprite*sheet*.{jpg,png,webp}');
    return;
  }

  console.log(`Found ${files.length} sprite sheet(s) in ${absoluteDir}\n`);

  for (const file of files) {
    const characterName = extractCharacterName(file);
    console.log(`--- ${file} → character: "${characterName}" ---`);
    splitSpriteSheet(path.join(absoluteDir, file), characterName, version);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  checkFfmpeg();

  const cliArgs = parseArgs();

  if (cliArgs.mode === 'batch') {
    runBatch(cliArgs.batchDir, cliArgs.version);
  } else {
    splitSpriteSheet(cliArgs.input, cliArgs.name, cliArgs.version);
  }

  console.log('Done.');
}

main();
