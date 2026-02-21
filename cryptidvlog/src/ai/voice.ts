/**
 * Voice synthesis — ElevenLabs primary, Cartesia fallback, OpenAI TTS last resort.
 * Never import this directly in gates — use only in pipeline/producer.ts.
 */
import { logger } from '../utils/logger.js';
import { telegram } from '../monitoring/telegram.js';
import { env } from '../config.js';

// Character voice IDs — set in ElevenLabs dashboard, stored in env
const VOICE_IDS: Record<string, string> = {
  yeti:    env.ELEVENLABS_YETI_VOICE_ID    ?? 'yeti-voice-id-placeholder',
  bigfoot: env.ELEVENLABS_BIGFOOT_VOICE_ID ?? 'bigfoot-voice-id-placeholder',
};

export async function synthesizeNarration(
  text: string,
  characterName: string,
  outputPath: string,
): Promise<string> {
  logger.info('Voice: synthesizing narration', { characterName, chars: text.length });
  try {
    return await elevenLabsSynthesize(text, characterName, outputPath);
  } catch (err) {
    logger.warn('ElevenLabs failed — trying Cartesia', { err });
    try {
      return await cartesiaSynthesize(text, characterName, outputPath);
    } catch (err2) {
      logger.warn('Cartesia failed — OpenAI TTS fallback', { err2 });
      await telegram.alert('ElevenLabs and Cartesia down — using OpenAI TTS.');
      return await openAiTtsSynthesize(text, outputPath);
    }
  }
}

async function elevenLabsSynthesize(
  text: string, characterName: string, outputPath: string,
): Promise<string> {
  const voiceId = VOICE_IDS[characterName] ?? VOICE_IDS['yeti']!;
  // TODO: ElevenLabs SDK text-to-speech with voiceId, save MP3 to outputPath
  throw new Error('ElevenLabs synthesize not implemented');
}

async function cartesiaSynthesize(
  text: string, characterName: string, outputPath: string,
): Promise<string> {
  // TODO: Cartesia REST API /tts/bytes, save audio to outputPath
  throw new Error('Cartesia synthesize not implemented');
}

async function openAiTtsSynthesize(text: string, outputPath: string): Promise<string> {
  // TODO: OpenAI audio.speech.create({ model: 'tts-1', voice: 'onyx', input: text }),
  //       stream to outputPath
  throw new Error('OpenAI TTS synthesize not implemented');
}
