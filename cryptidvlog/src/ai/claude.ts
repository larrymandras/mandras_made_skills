/**
 * Unified AI vision client — Anthropic Claude primary, GPT-4o fallback.
 * All gates and analysis go through here. Never import Anthropic/OpenAI directly in gates.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import { telegram } from '../monitoring/telegram.js';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const openai    = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export interface VisionInput {
  text: string;
  images: string[]; // base64 JPEG
}

export async function runVisionAnalysis(input: VisionInput, maxTokens = 500): Promise<string> {
  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: [
        { type: 'text', text: input.text },
        ...input.images.map(img => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: img },
        })),
      ]}],
    });
    return (res.content[0] as { text: string }).text;
  } catch (err) {
    if (err instanceof Anthropic.APIStatusError && err.status >= 500) {
      logger.warn('Anthropic unavailable — falling back to GPT-4o');
      await telegram.alert('Claude unavailable — using GPT-4o fallback for AI gates.');
      return gpt4oVision(input, maxTokens);
    }
    throw err;
  }
}

async function gpt4oVision(input: VisionInput, maxTokens: number): Promise<string> {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o', max_tokens: maxTokens,
    messages: [{ role: 'user', content: [
      { type: 'text', text: input.text },
      ...input.images.map(img => ({
        type: 'image_url' as const,
        image_url: { url: `data:image/jpeg;base64,${img}` },
      })),
    ]}],
  });
  return res.choices[0]?.message?.content ?? '';
}

export async function runTextAnalysis(prompt: string, maxTokens = 1000): Promise<string> {
  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return (res.content[0] as { text: string }).text;
  } catch (err) {
    if (err instanceof Anthropic.APIStatusError && err.status >= 500) {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o', max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.choices[0]?.message?.content ?? '';
    }
    throw err;
  }
}
