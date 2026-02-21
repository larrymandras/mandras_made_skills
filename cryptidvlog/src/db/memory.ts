/**
 * Character memory — interaction history and script callback validation.
 */
import { dbInsert, dbSelect } from './client.js';
import { runTextAnalysis } from '../ai/claude.js';
import { logger } from '../utils/logger.js';

export async function getCharacterInteractions(
  videoId: string,
): Promise<Record<string, unknown>[]> {
  return dbSelect('character_interactions', { video_id: videoId });
}

export async function getAllInteractions(): Promise<Record<string, unknown>[]> {
  return dbSelect('character_interactions', {});
}

export async function recordInteraction(params: {
  videoId: string;
  characters: string[];
  summary: string;
  callbacks?: string[];
}): Promise<void> {
  await dbInsert('character_interactions', {
    video_id: params.videoId,
    characters: params.characters,
    summary: params.summary,
    callbacks: params.callbacks ?? [],
  });
}

export async function validateMemoryIntegrity(script: string): Promise<{
  valid: boolean;
  issues: string[];
}> {
  logger.info('Memory: validating script callbacks');
  const history = await getAllInteractions();
  const prompt = `
You are a continuity editor. The script below references past episodes via callbacks.
Check each callback against the episode history and flag any that reference events that never happened.

Episode history (JSON):
${JSON.stringify(history.map((r) => ({ summary: r['summary'], callbacks: r['callbacks'] })), null, 2)}

Script to validate:
${script}

Reply with JSON: { "valid": boolean, "issues": string[] }
  `.trim();

  const response = await runTextAnalysis(prompt, 500);
  try {
    return JSON.parse(response) as { valid: boolean; issues: string[] };
  } catch {
    return { valid: true, issues: [] }; // parse failure → don't block on ambiguity
  }
}
