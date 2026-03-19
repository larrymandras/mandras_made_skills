#!/usr/bin/env tsx
/**
 * Quick test: runs the ideator to generate a concept, then the scriptwriter
 * to produce scene scripts. Does NOT generate video/audio.
 */
import { generateConcept } from '../src/pipeline/ideator.js';
import { writeScript } from '../src/pipeline/scriptwriter.js';

async function main() {
  console.log('=== IDEATOR TEST ===\n');

  console.log('Generating concept...');
  const concept = await generateConcept();

  console.log('\n--- CONCEPT ---');
  console.log(JSON.stringify(concept, null, 2));

  console.log('\n=== SCRIPTWRITER TEST ===\n');
  console.log('Writing script...');
  const scenes = await writeScript(concept);

  console.log(`\n--- SCRIPT (${scenes.length} scenes) ---`);
  for (const scene of scenes) {
    console.log(`\n[Scene ${scene.sceneIndex}] (${scene.estimatedDurationSeconds}s, pose: ${scene.targetPose})`);
    console.log(`  Narration: ${scene.narration}`);
    console.log(`  Dialogue: ${scene.dialogue}`);
    console.log(`  Visual: ${scene.visualDirection}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
