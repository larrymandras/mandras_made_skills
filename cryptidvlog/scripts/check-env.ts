#!/usr/bin/env tsx
/**
 * Pre-flight environment check — validates all required env vars via config.ts Zod schema.
 * Run: npm run check-env
 */
import { env } from '../src/config.js';

// config.ts import will throw descriptively on missing required vars
console.log('✓ All required environment variables are set');
console.log(`  SUPABASE_URL:      ${env.SUPABASE_URL}`);
console.log(`  ANTHROPIC_API_KEY: ${env.ANTHROPIC_API_KEY.slice(0, 8)}...`);
console.log(`  OPENAI_API_KEY:    ${env.OPENAI_API_KEY.slice(0, 8)}...`);
console.log(`  FAL_API_KEY:       ${env.FAL_API_KEY ? 'set' : 'MISSING'}`);
console.log(`  ELEVENLABS_API_KEY:${env.ELEVENLABS_API_KEY ? 'set' : 'MISSING'}`);
console.log(`  TELEGRAM_BOT:      ${env.TELEGRAM_BOT_TOKEN ? 'set' : 'MISSING'}`);
