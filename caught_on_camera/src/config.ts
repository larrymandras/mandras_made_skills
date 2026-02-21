import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

// ── Env Schema ────────────────────────────────────────────────────────────────

const EnvSchema = z.object({
  // AI / Generation
  FAL_KEY:                       z.string().min(1),
  ANTHROPIC_API_KEY:             z.string().min(1),

  // Database
  SUPABASE_URL:                  z.string().url(),
  SUPABASE_ANON_KEY:             z.string().min(1),
  SUPABASE_SERVICE_KEY:          z.string().min(1),

  // Video CDN
  CLOUDINARY_CLOUD_NAME:         z.string().min(1),
  CLOUDINARY_API_KEY:            z.string().min(1),
  CLOUDINARY_API_SECRET:         z.string().min(1),

  // Notifications
  TELEGRAM_BOT_TOKEN:            z.string().min(1),
  TELEGRAM_CHAT_ID:              z.string().min(1),

  // Publishing (Blotato)
  BLOTATO_API_KEY:               z.string().min(1),
  BLOTATO_YOUTUBE_ACCOUNT_ID:    z.string().min(1),
  BLOTATO_INSTAGRAM_ACCOUNT_ID:  z.string().min(1),
  BLOTATO_TIKTOK_ACCOUNT_ID:     z.string().min(1),

  // Feature flags / kill switches
  ENABLE_POLICE_SUBTYPE:         z.string().transform(v => v === 'true').default('true'),

  // Budget
  DAILY_BUDGET_HARD_CAP:         z.coerce.number().default(50),
  DAILY_BUDGET_WARNING:          z.coerce.number().default(40),
  DAILY_BUDGET_TARGET:           z.coerce.number().default(25),

  // Pipeline throughput
  VIDEOS_PER_DAY:                z.coerce.number().default(3),
  MIN_BUFFER_DAYS:               z.coerce.number().default(3),

  // Local storage
  TEMP_DIR:                      z.string().default('/tmp/caughtoncamera'),
  OVERLAYS_PATH:                 z.string().min(1),
  AUDIO_BEDS_PATH:               z.string().min(1),

  // Logging
  LOG_LEVEL:                     z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT:                    z.enum(['text', 'json']).default('text'),

  // Format schedule override (optional — falls back to hard-coded default)
  FORMAT_SCHEDULE:               z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map(i => i.path.join('.')).join(', ');
  throw new Error(`Missing or invalid environment variables: ${missing}`);
}

export const env = parsed.data;

// ── Domain Types ─────────────────────────────────────────────────────────────

export type CamFormat = 'ring_cam' | 'body_cam';

export type BodyCamSubType = 'police_security' | 'hiker_trail' | 'dashcam' | 'helmet_action';

// ── Budget ────────────────────────────────────────────────────────────────────

export const BUDGET = {
  hardCap:     env.DAILY_BUDGET_HARD_CAP,
  warning:     env.DAILY_BUDGET_WARNING,
  target:      env.DAILY_BUDGET_TARGET,
  retryReserve: 5,
} as const;

// ── Categories ────────────────────────────────────────────────────────────────

export const RING_CAM_CATEGORIES = [
  'animals',
  'paranormal',
  'delivery',
  'weather',
  'wholesome',
  'fails',
  'night_shift',
] as const;

export type RingCamCategory = typeof RING_CAM_CATEGORIES[number];

export const BODY_CAM_CATEGORIES = [
  'encounter',
  'pursuit',
  'discovery',
  'weather_nature',
  'night_ops',
  'response',
  'dashcam_chaos',
] as const;

export type BodyCamCategory = typeof BODY_CAM_CATEGORIES[number];

export const BODY_CAM_SUB_TYPES: BodyCamSubType[] = [
  'police_security',
  'hiker_trail',
  'dashcam',
  'helmet_action',
];

// ── Format Schedule ───────────────────────────────────────────────────────────
// day-of-week: 0 = Sunday, 1 = Monday … 6 = Saturday

export interface ScheduleEntry {
  format: CamFormat | 'operator_choice';
  category: string;
}

type WeekSchedule = Record<string, ScheduleEntry>;

const DEFAULT_FORMAT_SCHEDULE: WeekSchedule = {
  '0': { format: 'operator_choice', category: '' },
  '1': { format: 'ring_cam',        category: 'animals' },
  '2': { format: 'body_cam',        category: 'night_patrol' },
  '3': { format: 'ring_cam',        category: 'compilation' },
  '4': { format: 'body_cam',        category: 'trail' },
  '5': { format: 'ring_cam',        category: 'paranormal' },
  '6': { format: 'body_cam',        category: 'compilation' },
};

function parseFormatSchedule(raw: string | undefined): WeekSchedule {
  if (!raw) return DEFAULT_FORMAT_SCHEDULE;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    // Accept either full ScheduleEntry objects or "format/category" shorthand strings
    return Object.fromEntries(
      Object.entries(parsed).map(([day, value]) => {
        if (typeof value === 'string') {
          const [format, category = ''] = value.split('/');
          return [day, { format, category }] as [string, ScheduleEntry];
        }
        return [day, value] as [string, ScheduleEntry];
      }),
    );
  } catch {
    throw new Error('FORMAT_SCHEDULE must be valid JSON');
  }
}

export const FORMAT_SCHEDULE: WeekSchedule = parseFormatSchedule(env.FORMAT_SCHEDULE);

// ── Motion & Audio Thresholds ─────────────────────────────────────────────────

export const MOTION_THRESHOLDS = {
  ringCam: {
    maxAvg:   0.5,   // ring-cam clips should be mostly static
    maxSpike: 2.0,
  },
  bodyCam: {
    minAvg:   1.5,   // body-cam clips must show meaningful camera motion
  },
} as const;

export const AUDIO_THRESHOLDS = {
  silenceDb:   -40,  // below this is considered silence
  ringCamMax:  -10,  // ring-cam audio should stay below this peak
  bodyCAMmin:  -35,  // body-cam audio must exceed this floor (has ambient noise)
} as const;

// ── Platform Limits ───────────────────────────────────────────────────────────

export const PLATFORM_LIMITS = {
  youtube: {
    maxPerDay:        2,
    minHoursBetween:  4,
    maxPerWeek:       10,
  },
  tiktok: {
    maxPerDay:        3,
    minHoursBetween:  2,
    maxPerWeek:       14,
  },
  instagram: {
    maxPerDay:        2,
    minHoursBetween:  4,
    maxPerWeek:       10,
  },
  shorts: {
    maxPerDay:        2,
    minHoursBetween:  4,
    maxPerWeek:       10,
  },
} as const;

// ── Storage Retention ─────────────────────────────────────────────────────────

export const STORAGE_RETENTION = {
  rawClipDays:    7,   // days to keep raw generated clips before purge
  rejectedDays:   0,   // rejected clips purged immediately
  approvedDays:   90,  // approved/published clips kept in Cloudinary for 90 days
} as const;

// ── Retry Policy ──────────────────────────────────────────────────────────────

export const RETRY_POLICY = {
  maxRetries:  3,
  retryWaitMs: 10_000,
} as const;
