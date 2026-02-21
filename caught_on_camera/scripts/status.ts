#!/usr/bin/env tsx
/**
 * Operational status dashboard for Caught on Camera.
 * Prints current system state: buffer, spend, format schedule, ideas queue,
 * platform health, last published video, and active pauses.
 * Run: npm run status
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

function green(s: string)  { return `${GREEN}${s}${RESET}`; }
function red(s: string)    { return `${RED}${s}${RESET}`; }
function yellow(s: string) { return `${YELLOW}${s}${RESET}`; }
function cyan(s: string)   { return `${CYAN}${s}${RESET}`; }
function bold(s: string)   { return `${BOLD}${s}${RESET}`; }
function dim(s: string)    { return `${DIM}${s}${RESET}`; }

// ── Types ─────────────────────────────────────────────────────────────────────

interface Video {
  id: string;
  status: string;
  format: string;
  published_at: string | null;
  title: string | null;
  view_count: number | null;
}

interface DailyBudget {
  total_cost_usd: number;
}

interface IdeaCount {
  format: string;
  status: string;
  count: number;
}

interface PlatformHealth {
  platform: string;
  status: 'normal' | 'warning' | 'degraded' | 'down';
  suppression_detected: boolean;
  last_checked_at: string;
}

interface ActivePause {
  category: string;
  paused_until: string | null;
  paused_all: boolean;
}

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env['SUPABASE_URL'];
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_KEY'];
const BUDGET_HARD_CAP      = Number(process.env['DAILY_BUDGET_HARD_CAP'] ?? '50');
const BUDGET_WARNING       = Number(process.env['DAILY_BUDGET_WARNING']  ?? '40');
const MIN_BUFFER_DAYS      = Number(process.env['MIN_BUFFER_DAYS']        ?? '3');
const VIDEOS_PER_DAY       = Number(process.env['VIDEOS_PER_DAY']         ?? '3');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(`${RED}SUPABASE_URL and SUPABASE_SERVICE_KEY must be set. Run: npm run check-env${RESET}`);
  process.exit(1);
}

const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_FORMAT_SCHEDULE: Record<string, { format: string; category: string }> = {
  '0': { format: 'operator_choice', category: '' },
  '1': { format: 'ring_cam',        category: 'animals' },
  '2': { format: 'body_cam',        category: 'night_patrol' },
  '3': { format: 'ring_cam',        category: 'compilation' },
  '4': { format: 'body_cam',        category: 'trail' },
  '5': { format: 'ring_cam',        category: 'paranormal' },
  '6': { format: 'body_cam',        category: 'compilation' },
};

function getSchedule(): Record<string, { format: string; category: string }> {
  const raw = process.env['FORMAT_SCHEDULE'];
  if (!raw) return DEFAULT_FORMAT_SCHEDULE;
  try {
    return JSON.parse(raw) as Record<string, { format: string; category: string }>;
  } catch {
    return DEFAULT_FORMAT_SCHEDULE;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours   = Math.floor(diff / 3_600_000);
  const days    = Math.floor(diff / 86_400_000);
  if (days > 0)    return `${days}d ago`;
  if (hours > 0)   return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

function budgetBar(spent: number, cap: number): string {
  const pct      = Math.min(spent / cap, 1);
  const filledW  = Math.round(pct * 20);
  const emptyW   = 20 - filledW;
  const bar      = '█'.repeat(filledW) + '░'.repeat(emptyW);
  const color    = pct >= 1 ? RED : pct >= 0.8 ? YELLOW : GREEN;
  return `${color}${bar}${RESET}`;
}

function formatHealth(status: string): string {
  switch (status) {
    case 'normal':   return green('NORMAL');
    case 'warning':  return yellow('WARNING');
    case 'degraded': return yellow('DEGRADED');
    case 'down':     return red('DOWN');
    default:         return dim('UNKNOWN');
  }
}

function bufferStatus(bufferDays: number): string {
  if (bufferDays >= MIN_BUFFER_DAYS) return green(`${bufferDays.toFixed(1)} days`);
  if (bufferDays >= 1)               return yellow(`${bufferDays.toFixed(1)} days`);
  return red(`${bufferDays.toFixed(1)} days`);
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchBuffer(): Promise<{ count: number; days: number }> {
  const { data, error } = await sb
    .from('videos')
    .select('id', { count: 'exact' })
    .eq('status', 'approved')
    .is('published_at', null);
  if (error) throw new Error(`Buffer query failed: ${error.message}`);
  const count = data?.length ?? 0;
  return { count, days: count / VIDEOS_PER_DAY };
}

async function fetchDailySpend(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('daily_budget_log')
    .select('total_cost_usd')
    .eq('date', today)
    .single();
  if (error && error.message.includes('No rows')) return 0;
  if (error) return 0;
  return (data as DailyBudget | null)?.total_cost_usd ?? 0;
}

async function fetchIdeasQueue(): Promise<{ ring_cam: number; body_cam: number }> {
  const { data, error } = await sb
    .from('ideas_queue')
    .select('format')
    .eq('status', 'pending');
  if (error) return { ring_cam: 0, body_cam: 0 };
  const rows = (data ?? []) as { format: string }[];
  return {
    ring_cam: rows.filter(r => r.format === 'ring_cam').length,
    body_cam: rows.filter(r => r.format === 'body_cam').length,
  };
}

async function fetchPlatformHealth(): Promise<PlatformHealth[]> {
  const { data, error } = await sb
    .from('platform_health')
    .select('platform, status, suppression_detected, last_checked_at')
    .order('platform');
  if (error) return [];
  return (data ?? []) as PlatformHealth[];
}

async function fetchLastVideo(): Promise<Video | null> {
  const { data, error } = await sb
    .from('videos')
    .select('id, status, format, published_at, title, view_count')
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as Video | null;
}

async function fetchActivePauses(): Promise<ActivePause[]> {
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('content_pauses')
    .select('category, paused_until, paused_all')
    .or(`paused_until.gt.${now},paused_all.eq.true`);
  if (error) return [];
  return (data ?? []) as ActivePause[];
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n${bold('=== Caught on Camera — System Status ===')}  ${dim(new Date().toLocaleString())}\n`);

const schedule    = getSchedule();
const todayDow    = String(new Date().getDay());
const tomorrowDow = String((new Date().getDay() + 1) % 7);
const todayEntry  = schedule[todayDow]    ?? { format: 'ring_cam', category: '' };
const tomorrowEnt = schedule[tomorrowDow] ?? { format: 'ring_cam', category: '' };

// Fetch everything in parallel for fast output
const [buffer, spend, ideas, platforms, lastVideo, pauses] = await Promise.allSettled([
  fetchBuffer(),
  fetchDailySpend(),
  fetchIdeasQueue(),
  fetchPlatformHealth(),
  fetchLastVideo(),
  fetchActivePauses(),
]);

// ── Buffer ────────────────────────────────────────────────────────────────────

const bufResult  = buffer.status === 'fulfilled' ? buffer.value : { count: 0, days: 0 };
const bufferLine = `${bufResult.count} video(s) approved + unpublished  (${bufferStatus(bufResult.days)})`;
const bufferWarn = bufResult.days < MIN_BUFFER_DAYS
  ? `  ${yellow('⚠ Below target buffer of ' + MIN_BUFFER_DAYS + ' days — run pipeline')}`
  : '';

console.log(`${bold('Buffer:')}          ${bufferLine}${bufferWarn}`);

// ── Daily spend ───────────────────────────────────────────────────────────────

const spendVal  = spend.status === 'fulfilled' ? spend.value : 0;
const spendPct  = Math.round((spendVal / BUDGET_HARD_CAP) * 100);
const spendBar  = budgetBar(spendVal, BUDGET_HARD_CAP);
const spendWarn = spendVal >= BUDGET_HARD_CAP
  ? `  ${red('HARD CAP REACHED — no more generation today')}`
  : spendVal >= BUDGET_WARNING
  ? `  ${yellow('⚠ Warning threshold reached')}`
  : '';

console.log(`${bold('Daily spend:')}     $${spendVal.toFixed(2)} / $${BUDGET_HARD_CAP.toFixed(2)}  ${spendBar}  ${spendPct}%${spendWarn}`);

// ── Format schedule ───────────────────────────────────────────────────────────

const todayLabel    = cyan(todayEntry.format.replace('_', ' ').toUpperCase());
const tomorrowLabel = cyan(tomorrowEnt.format.replace('_', ' ').toUpperCase());
const todayCat      = todayEntry.category ? dim(` (${todayEntry.category})`) : '';
const tomorrowCat   = tomorrowEnt.category ? dim(` (${tomorrowEnt.category})`) : '';

console.log(`${bold('Format schedule:')} Today ${DAY_NAMES[Number(todayDow)]} → ${todayLabel}${todayCat}   Tomorrow → ${tomorrowLabel}${tomorrowCat}`);

// ── Ideas queue ───────────────────────────────────────────────────────────────

const ideasResult = ideas.status === 'fulfilled' ? ideas.value : { ring_cam: 0, body_cam: 0 };
const ideasLine   = `${cyan(String(ideasResult.ring_cam))} ring_cam pending,  ${cyan(String(ideasResult.body_cam))} body_cam pending`;

console.log(`${bold('Ideas queue:')}     ${ideasLine}`);

// ── Platform health ───────────────────────────────────────────────────────────

const platformList = platforms.status === 'fulfilled' ? platforms.value : [];
console.log(`${bold('Platform health:')}`);

if (platformList.length === 0) {
  console.log(`  ${dim('No platform health data — run pipeline once to populate')}`);
} else {
  for (const p of platformList) {
    const statusTag   = formatHealth(p.status);
    const suppression = p.suppression_detected ? `  ${yellow('⚠ suppression detected')}` : '';
    const checked     = p.last_checked_at ? dim(`  checked ${timeAgo(p.last_checked_at)}`) : '';
    console.log(`  ${p.platform.padEnd(12)} ${statusTag}${suppression}${checked}`);
  }
}

// ── Last published video ──────────────────────────────────────────────────────

const lastVid = lastVideo.status === 'fulfilled' ? lastVideo.value : null;
if (lastVid?.published_at) {
  const ago    = timeAgo(lastVid.published_at);
  const title  = lastVid.title ?? lastVid.id;
  const views  = lastVid.view_count != null ? `${lastVid.view_count.toLocaleString()} views` : 'views unknown';
  const fmt    = cyan(`[${lastVid.format.replace('_', ' ').toUpperCase()}]`);
  console.log(`${bold('Last video:')}     ${fmt} ${title}  —  published ${ago}  —  ${views}`);
} else {
  console.log(`${bold('Last video:')}     ${dim('No videos published yet')}`);
}

// ── Active pauses ─────────────────────────────────────────────────────────────

const pauseList = pauses.status === 'fulfilled' ? pauses.value : [];
if (pauseList.length === 0) {
  console.log(`${bold('Active pauses:')}  ${green('none')}`);
} else {
  console.log(`${bold('Active pauses:')}`);
  for (const p of pauseList) {
    if (p.paused_all) {
      console.log(`  ${red('ALL CONTENT')}  paused${p.paused_until ? ` until ${new Date(p.paused_until).toLocaleDateString()}` : ' indefinitely'}`);
    } else {
      const until = p.paused_until
        ? `until ${new Date(p.paused_until).toLocaleDateString()}`
        : 'indefinitely';
      console.log(`  ${yellow(p.category)}  paused ${until}`);
    }
  }
}

console.log('');
