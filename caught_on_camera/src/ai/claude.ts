/**
 * AI text + vision client — Claude Sonnet 4.6 only.
 * No GPT-4o fallback needed: caught-on-camera has no character consistency
 * requirement that demands vision-model parity between providers.
 *
 * All content review, deduplication, and policy checks go through here.
 * Never import Anthropic directly in gates or pipeline modules.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config.js';
import { logger } from '../utils/logger.js';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-6';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface FrameInput {
  /** Base64-encoded JPEG frame */
  data: string;
  /** Optional label for logging (e.g. "frame_0003") */
  label?: string;
}

export interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// ── Frame analysis (vision) ───────────────────────────────────────────────────

/**
 * Analyse one or more video frames with a caller-supplied prompt.
 * Typical use-cases: authenticity gate, motion quality check, policy screen.
 *
 * @param frames  Array of base64 JPEG frames extracted from the generated clip.
 * @param prompt  The instruction / question to apply to the frames.
 * @param maxTokens  Response token budget (default 500).
 */
export async function analyzeFrames(
  frames: FrameInput[],
  prompt: string,
  maxTokens = 500,
): Promise<ClaudeResponse> {
  logger.debug('claude.analyzeFrames', { frameCount: frames.length, maxTokens });

  const imageBlocks: Anthropic.ImageBlockParam[] = frames.map(f => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: f.data },
  }));

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...imageBlocks,
      ],
    }],
  });

  const text = (res.content[0] as { text: string }).text;
  logger.debug('claude.analyzeFrames complete', {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  });

  return {
    text,
    inputTokens:  res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

// ── Text completion ───────────────────────────────────────────────────────────

/**
 * General-purpose text completion (no vision).
 * Use for: dedup hash generation, content scoring, policy description checks,
 * prompt augmentation.
 *
 * @param prompt       The user-turn message.
 * @param systemPrompt Optional system prompt; defaults to a neutral assistant persona.
 * @param maxTokens    Response token budget (default 1000).
 */
export async function generateCompletion(
  prompt: string,
  systemPrompt?: string,
  maxTokens = 1_000,
): Promise<ClaudeResponse> {
  logger.debug('claude.generateCompletion', { maxTokens });

  // TODO: add token-cost tracking and route through budget ledger
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (res.content[0] as { text: string }).text;
  logger.debug('claude.generateCompletion complete', {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  });

  return {
    text,
    inputTokens:  res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}
