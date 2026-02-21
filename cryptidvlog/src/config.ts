import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const EnvSchema = z.object({
  ANTHROPIC_API_KEY:           z.string().min(1),
  OPENAI_API_KEY:              z.string().min(1),
  FAL_API_KEY:                 z.string().min(1),
  REPLICATE_API_KEY:           z.string().min(1),
  ELEVENLABS_API_KEY:          z.string().min(1),
  ELEVENLABS_YETI_VOICE_ID:    z.string().min(1),
  ELEVENLABS_BIGFOOT_VOICE_ID: z.string().min(1),
  CARTESIA_API_KEY:            z.string().min(1),
  CARTESIA_YETI_VOICE_ID:      z.string().min(1),
  CARTESIA_BIGFOOT_VOICE_ID:   z.string().min(1),
  SUPABASE_URL:                z.string().url(),
  SUPABASE_SERVICE_KEY:        z.string().min(1),
  BLOTATO_API_KEY:             z.string().min(1),
  YOUTUBE_CLIENT_ID:           z.string().min(1),
  YOUTUBE_CLIENT_SECRET:       z.string().min(1),
  YOUTUBE_REFRESH_TOKEN:       z.string().min(1),
  YOUTUBE_CHANNEL_ID:          z.string().min(1),
  TIKTOK_ACCESS_TOKEN:         z.string().min(1),
  INSTAGRAM_ACCESS_TOKEN:      z.string().min(1),
  INSTAGRAM_ACCOUNT_ID:        z.string().min(1),
  TELEGRAM_BOT_TOKEN:          z.string().min(1),
  TELEGRAM_CHAT_ID:            z.string().min(1),
  RCLONE_REMOTE:               z.string().default('gdrive'),
  GDRIVE_REFERENCES_FOLDER:    z.string().default('cryptidvlog-references'),
  GDRIVE_ARCHIVE_FOLDER:       z.string().default('cryptidvlog-archive'),
  GDRIVE_OUTPUT_FOLDER:        z.string().default('cryptidvlog-output'),
  DAILY_BUDGET_HARD_CAP:       z.coerce.number().default(75),
  DAILY_BUDGET_WARNING:        z.coerce.number().default(60),
  DAILY_BUDGET_TARGET:         z.coerce.number().default(45),
  AB_BUDGET_DAILY:             z.coerce.number().default(16),
  RETRY_RESERVE:               z.coerce.number().default(8),
  VIDEOS_PER_DAY:              z.coerce.number().default(2),
  SCENES_PER_VIDEO:            z.coerce.number().default(4),
  MIN_BUFFER_DAYS:             z.coerce.number().default(2),
  VENDOR_OUTAGE_BUFFER_DAYS:   z.coerce.number().default(5),
  CONSISTENCY_REJECT_THRESHOLD:z.coerce.number().default(70),
  CONSISTENCY_SAVE_THRESHOLD:  z.coerce.number().default(95),
  MAX_SCENE_RETRIES:           z.coerce.number().default(2),
  MAX_VIDEO_RETRIES:           z.coerce.number().default(4),
  TEMP_DIR:                    z.string().default('/tmp/cryptidvlog'),
  MUSIC_LIBRARY_PATH:          z.string().default(process.env['HOME'] + '/cryptidvlog/assets/music'),
  CHARACTER_ASSETS_PATH:       z.string().default(process.env['HOME'] + '/cryptidvlog/assets/characters'),
  LOG_LEVEL:  z.enum(['debug','info','warn','error']).default('info'),
  LOG_FORMAT: z.enum(['text','json']).default('text'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map(i => i.path.join('.')).join(', ');
  throw new Error(`Missing or invalid environment variables: ${missing}`);
}

export const env = parsed.data;

export const BUDGET = {
  hardCap:               env.DAILY_BUDGET_HARD_CAP,
  warning:               env.DAILY_BUDGET_WARNING,
  target:                env.DAILY_BUDGET_TARGET,
  abDaily:               env.AB_BUDGET_DAILY,
  retryReserve:          env.RETRY_RESERVE,
  abPerVideo:            8.00,
  skipAbIfSpendExceeds:  55,
} as const;

export const CHARACTER_VOICE_RANGES = {
  yeti:    { min: 170, max: 290 },
  bigfoot: { min: 80,  max: 180 },
} as const;

export const CONSISTENCY = {
  rejectBelow:            env.CONSISTENCY_REJECT_THRESHOLD,
  saveAbove:              env.CONSISTENCY_SAVE_THRESHOLD,
  trendAlertBelow:        80,
  trendWindowEpisodes:    10,
} as const;

export const STORAGE_RETENTION = {
  rawSceneDays:           3,
  abVariantDays:          1,
  assembledDays:          90,
  consistencyFrameDays:   1,
} as const;

export const RETRY_POLICY = {
  maxRetriesPerScene: env.MAX_SCENE_RETRIES,
  maxRetriesPerVideo: env.MAX_VIDEO_RETRIES,
  retryWaitMs:        10_000,
} as const;

export type CharacterName = keyof typeof CHARACTER_VOICE_RANGES;
