# CRYPTID VLOG — DESIGN DOCUMENT

**Version:** 1.0
**Date:** 2026-02-21
**Project:** Cryptid Vlog AI Pipeline
**Runtime:** Node.js 20+ / TypeScript (ESM), WSL2 on Windows 11
**Claude Skill Model:** claude-sonnet-4-6

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Data Flow: Full Pipeline Run](#3-data-flow-full-pipeline-run)
4. [Component Reference](#4-component-reference)
5. [Database Schema Reference](#5-database-schema-reference)
6. [AI Model Usage](#6-ai-model-usage)
7. [Gate Pipeline Reference](#7-gate-pipeline-reference)
8. [Vendor Fallback Matrix](#8-vendor-fallback-matrix)
9. [Budget Model](#9-budget-model)
10. [Error Handling Strategy](#10-error-handling-strategy)
11. [Security Model](#11-security-model)
12. [WSL2 Integration Notes](#12-wsl2-integration-notes)
13. [Configuration Reference](#13-configuration-reference)

---

## 1. System Overview

### What It Is

Cryptid Vlog is an autonomous daily video production pipeline implemented as a Claude Code skill. It produces short-form vertical videos featuring recurring AI characters — **Yeti** (anxious tech nerd) and **Bigfoot** (laid-back outdoorsman) — and publishes them to YouTube Shorts, TikTok, and Instagram Reels without daily human intervention.

The pipeline is opinionated: Claude makes all creative and routing decisions; deterministic TypeScript scripts handle file I/O, API calls, FFmpeg operations, and database writes. This separation keeps AI reasoning auditable and costs predictable.

### What It Produces

- 1–2 videos per day (configurable)
- 4–5 scenes per video, each 6–15 seconds
- Vertical format (1080×1920, 9:16)
- Character voice lines via ElevenLabs, video via fal.ai Veo 3.1
- Simultaneous publication to YouTube Shorts, TikTok, and Instagram Reels

### Skill Invocation Model

**Claude decides:** concept, script, character dialogue, A/B variant selection, gate-fail remediation strategy.
**TypeScript executes:** HTTP requests, file writes, FFmpeg commands, database inserts, retry logic, cost accounting.

### WSL2 / Windows 11 Deployment Context

The pipeline runs inside a WSL2 Ubuntu instance on Windows 11. Windows Task Scheduler fires a bridge script that calls `wsl.exe` to invoke Node.js. All media scratch space lives under `/tmp/cryptidvlog/` inside WSL2.

---

## 2. Architecture Diagram

```
+---------------------------------------------------------------------+
|                        CLAUDE CODE SKILL                            |
|                     (claude-sonnet-4-6)                             |
|  Orchestrates decisions, routes failures, approves scripts          |
+------------------------+--------------------------------------------+
                         | invokes
         +---------------v---------------+
         |       PIPELINE MODULES        |
         |  ideator → scriptwriter →     |
         |  producer → assembler →       |
         |  publisher                    |
         +-------+---------------+-------+
                 |               |
    +------------v--+   +--------v----------------+
    |  AI CLIENTS   |   |  GATE RUNNER            |
    |  (src/ai/)    |   |  gate1 through gate7    |
    +------+--------+   +--------+----------------+
           |                     |
    +------v---------------------v--------+
    |            VENDOR LAYER             |
    |                                     |
    |  Text/Vision        Video Gen       |
    |  Anthropic Claude   fal.ai Veo 3.1  |
    |    ↓ fallback         ↓ fallback    |
    |  OpenAI GPT-4o      Replicate       |
    |                       ↓ fallback    |
    |                     Slideshow       |
    |                                     |
    |  Voice              Database        |
    |  ElevenLabs         Supabase        |
    |    ↓ fallback         ↓ fallback    |
    |  Cartesia           SQLite local    |
    |    ↓ fallback                       |
    |  OpenAI TTS                         |
    +------------------------------------+
           |                     |
    +------v------+       +------v------+
    |  PLATFORMS  |       |  MEDIA      |
    |  YouTube    |       |  FFmpeg     |
    |  TikTok     |       |  frames.ts  |
    |  Instagram  |       |  audio.ts   |
    +------+------+       +-------------+
           |
    +------v-----------+
    |  MONITORING      |
    |  Telegram Bot    |
    |  Cost tracking   |
    |  Vendor health   |
    +------------------+
```

### Vendor Fallback Chains

```
TEXT / VISION
  Anthropic claude-sonnet-4-6
    ↓ (5xx / timeout after 3 retries)
  OpenAI GPT-4o
    ↓ (5xx / timeout)
  HARD FAIL → operator alert

VIDEO GENERATION
  fal.ai Veo 3.1
    ↓ (>90s timeout / 3 errors)
  Replicate (compatible model)
    ↓ (>120s timeout)
  Slideshow fallback (FFmpeg ken-burns on reference image)
    ↓ (FFmpeg error)
  FAIL → scene skipped

VOICE SYNTHESIS
  ElevenLabs (character voice clone)
    ↓ (5xx / >30s)
  Cartesia (cloned voice)
    ↓ (5xx / >30s)
  OpenAI TTS (tts-1)
    ↓ (error)
  FAIL → scene uses silence

DATABASE
  Supabase (hosted Postgres)
    ↓ (ECONNREFUSED / timeout)
  better-sqlite3 (local /tmp/cryptidvlog/fallback.db)
    ↓ (write error)
  FAIL → log to file, alert operator
```

---

## 3. Data Flow: Full Pipeline Run

```
START: Windows Task Scheduler fires at 06:00 local
  ↓
[1] ENV VALIDATION  (src/config.ts)
    Zod validates all required vars → EXIT 1 + alert if any missing

[2] DAILY BUDGET CHECK  (src/db/costs.ts)
    Query daily_budget_log → if spend >= $75.00 → ABORT

[3] BUFFER CHECK  (src/monitoring/buffer.ts)
    Count approved-and-unpublished videos → if >= BUFFER_MAX → SKIP

[4] VENDOR HEALTH CHECK  (src/monitoring/vendor-health.ts)
    Ping each primary vendor → log vendor_health_log

[5] IDEATION  (src/pipeline/ideator.ts)
    Pull from concept_injection_queue OR auto-generate via Claude
    Output: { conceptTitle, hook, sceneCount, characterFocus, estimatedCost }

[6] SCRIPT WRITING  (src/pipeline/scriptwriter.ts)
    Validate character memory integrity (callbacks → real episodes)
    Claude writes N scene scripts with narration + dialogue + visual direction

[7] PRODUCE SCENES  (src/pipeline/producer.ts)  [per scene]
    ├─ [7a] Video generation: fal.ai Veo → Replicate → Slideshow
    ├─ [7b] Voice synthesis: ElevenLabs → Cartesia → OpenAI TTS
    ├─ [7c] Gate 1 (character consistency ≥ 70)
    ├─ [7d] Gate 2 (scene continuity)
    ├─ [7e] Gate 3 (body detection)
    └─ Retry once on gate fail → mark degraded if retry fails

[8] FULL-VIDEO GATES
    Gate 4 (content policy + DMCA)  → HARD FAIL if triggered
    Gate 7 (watermark + disclosure) → HARD FAIL if triggered

[9] ASSEMBLY  (src/pipeline/assembler.ts)
    concat → mix audio → crop safe zone → burn watermark
    Output: final.mp4 at /tmp/cryptidvlog/videos/{id}/

[10] HUMAN REVIEW  (Telegram)
     Send reviewRequest() → status = 'pending_review'
     Operator replies: ✅ approve {id} | ❌ reject {id} [reason]

[11] PUBLISH  (src/pipeline/publisher.ts)  [after approve]
     Upload to YouTube + TikTok + Instagram
     Set synthetic media label + not-for-kids flag on all platforms
     Update videos.status = 'published'

[12] MONITORING REPORT
     Telegram summary: cost, gate results, vendor tier used

[13] A/B VARIANT  (if eligible and budget allows)
     Generate variant with alternate hook → same gate pipeline → separate review
```

---

## 4. Component Reference

### Pipeline (`src/pipeline/`)

| Module | Purpose |
|--------|---------|
| `ideator.ts` | Concept selection from queue or Claude auto-generation |
| `scriptwriter.ts` | Scene script generation with memory integrity validation |
| `producer.ts` | Per-scene video + audio generation with gate 1–3 checking |
| `assembler.ts` | FFmpeg pipeline: concat → audio mix → crop → watermark |
| `publisher.ts` | Multi-platform upload with synthetic media labels |
| `index.ts` | Orchestrates all pipeline stages with budget/buffer guards |

### Gates (`src/gates/`)

| Gate | Check | Fail Type |
|------|-------|-----------|
| `gate1-consistency.ts` | Character visual match via Claude vision | Soft (mark degraded) |
| `gate2-continuity.ts` | Scene-to-scene visual continuity | Soft (retry 1×) |
| `gate3-face.ts` | Character body detection in frames | Soft (skip scene) |
| `gate4-policy.ts` | Content policy + DMCA audio check | **Hard fail** |
| `gate5-voice.ts` | MOS ≥ 0.8, frequency in character range | Soft (retry 1×) |
| `gate6-crop.ts` | All UI within 9:16 safe zone | Soft (re-crop) |
| `gate7-watermark.ts` | Watermark + disclosure text present | **Hard fail** |
| `index.ts` | Gate runner — orchestrates 1–7, enforces hard-fail semantics | — |

### AI Clients (`src/ai/`)

| Module | Purpose |
|--------|---------|
| `claude.ts` | Text + vision via Anthropic; GPT-4o fallback |
| `veo.ts` | Video generation: fal.ai → Replicate → slideshow |
| `voice.ts` | Voice synthesis: ElevenLabs → Cartesia → OpenAI TTS |

### Database (`src/db/`)

| Module | Purpose |
|--------|---------|
| `client.ts` | Supabase primary, SQLite fallback, sync recovery |
| `characters.ts` | Character profiles, reference images, consistency scores |
| `costs.ts` | Scene/video cost writes, daily budget queries, cap enforcement |
| `memory.ts` | Character interaction history, memory integrity validation |
| `videos.ts` | Video/scene CRUD, status management, buffer depth |

### Media (`src/media/`)

| Module | Purpose |
|--------|---------|
| `ffmpeg.ts` | Concatenation, audio mixing, crop, watermark burn |
| `frames.ts` | Frame extraction for gate vision analysis |
| `audio.ts` | Strip, normalize, MOS score, frequency detection |

### Monitoring (`src/monitoring/`)

| Module | Purpose |
|--------|---------|
| `telegram.ts` | Non-blocking alerts: alert/info/error/reviewRequest |
| `costs.ts` | Cost tracking with 80%/95% cap alerts |
| `buffer.ts` | Buffer depth check and low-buffer alerts |
| `vendor-health.ts` | Polls all 5 vendor status pages every 30 min |

### Platforms (`src/platforms/`)

| Module | Purpose |
|--------|---------|
| `youtube.ts` | YouTube Shorts upload + delete (synthetic media label) |
| `tiktok.ts` | TikTok upload + delete (AIGC label) |
| `instagram.ts` | Instagram Reels upload + delete |
| `blotato.ts` | Optional multi-platform scheduler |

### Scripts (`scripts/`)

| Script | `npm run` command | Purpose |
|--------|-------------------|---------|
| `check-env.ts` | `check-env` | Validate all required env vars |
| `setup-db.ts` | `setup-db` | Run SQL migrations against Supabase |
| `smoke-test.ts` | `smoke-test` | Verify all integrations are reachable |
| `emergency-takedown.ts` | `emergency-takedown` | Remove video from all platforms |

---

## 5. Database Schema Reference

### Migration 001 — Core Pipeline

| Table | Purpose |
|-------|---------|
| `videos` | One row per generated video; tracks status through pipeline |
| `scenes` | Per-scene assets, gate results, retry count |
| `ab_test_results` | A/B variant assignment and performance metrics |
| `concept_injection_queue` | Operator-supplied concept overrides |

### Migration 002 — Characters

| Table | Purpose |
|-------|---------|
| `characters` | Character profiles (seeded: yeti, bigfoot) |
| `character_consistency_scores` | Gate 1 score history per scene |
| `character_reference_images` | Manual + auto-extracted reference frames |
| `character_interactions` | Episode-level interaction summaries for memory |
| `character_ip_registry` | IP risk tracking for character assets |

### Migration 003 — Cost Tracking

| Table | Purpose |
|-------|---------|
| `scene_costs` | Per-vendor cost per scene |
| `video_costs` | Aggregated cost per video |
| `daily_budget_log` | Running daily spend (one row per date, UNIQUE) |
| `storage_files` | File registry for retention management |

### Migration 004 — Compliance

| Table | Purpose |
|-------|---------|
| `gdpr_deletion_log` | GDPR deletion events (no raw PII) |
| `takedown_log` | Emergency takedown history |
| `newsletter_signups` | Email opt-ins as SHA-256 hashes only |
| `platform_publishes` | Per-platform publish records with synthetic media flags |

### Migration 005 — Operations

| Table | Purpose |
|-------|---------|
| `vendor_health_log` | Health check results per vendor |
| `storage_sync_queue` | SQLite fallback sync queue |
| `current_vendor_health` | VIEW: latest status per vendor |

---

## 6. AI Model Usage

| Purpose | Primary Model | Fallback |
|---------|--------------|---------|
| Vision analysis (gates 1, 2, 3, 7) | claude-sonnet-4-6 | gpt-4o |
| Text analysis (scripting, gate 4, memory) | claude-sonnet-4-6 | gpt-4o |
| Video generation | fal.ai Veo 3.1 | Replicate → Slideshow |
| Voice synthesis | ElevenLabs (voice clone) | Cartesia → OpenAI TTS |
| Smoke test (minimal cost) | claude-haiku-4-5-20251001 | — |

---

## 7. Gate Pipeline Reference

| Gate | Name | Input | Threshold | Fail Type | Fail Action |
|------|------|-------|-----------|-----------|-------------|
| 1 | Character Consistency | Scene frames | Score ≥ 70/100 | Soft | Mark degraded; retry 1× |
| 2 | Scene Continuity | Last/first frame pair | Pass | Soft | Retry 1× |
| 3 | Body Detection | All frames | > 50% frames | Soft | Skip scene |
| 4 | Content Policy + DMCA | Script + audio | No flags | **Hard** | Abort publish; strip audio |
| 5 | Voice Quality | Audio track | MOS ≥ 0.8 | Soft | Retry 1×; re-synthesize |
| 6 | Crop Safety | Final video | All UI in 9:16 zone | Soft | Re-crop + re-run gate |
| 7 | Watermark + Disclosure | Final video frames | Both present | **Hard** | Re-assemble with watermark |

---

## 8. Vendor Fallback Matrix

| Service | Primary | Fallback 1 | Fallback 2 | Outage Threshold |
|---------|---------|-----------|-----------|-----------------|
| Text/Vision AI | Anthropic claude-sonnet-4-6 | OpenAI GPT-4o | Hard fail | 5xx or 3 timeouts |
| Video generation | fal.ai Veo 3.1 | Replicate | FFmpeg slideshow | > 90s timeout |
| Voice synthesis | ElevenLabs | Cartesia | OpenAI TTS | > 30s / 5xx |
| Database | Supabase | SQLite local | File log only | ECONNREFUSED |
| Video publishing | YouTube/TikTok/Instagram direct | — | Manual queue | 3 consecutive errors |
| Monitoring | Telegram Bot API | Log file | — | Any error (non-fatal) |

---

## 9. Budget Model

```
Per scene (4 scenes per video):
  Video generation (fal.ai Veo)     ≈ $0.50
  Voice synthesis (ElevenLabs)      ≈ $0.03
  Claude vision (gates)             ≈ $0.02
  ─────────────────────────────────────────
  Subtotal per scene                ≈ $0.55

Per video (4 scenes):
  4 × $0.55 scene cost              ≈ $2.20
  Claude text (script, ideation)    ≈ $0.05
  ─────────────────────────────────────────
  Base cost per video               ≈ $2.25

Daily (1 video, normal):            ≈ $2–$5
Daily (2 videos with A/B):          ≈ $6–$12
Hard cap:                           $75.00
Headroom vs daily normal:           > 10×
```

**Cap enforcement:**
1. `checkBudgetCap()` runs at pipeline start — aborts if `daily_spend >= $75`
2. `alertIfNearCap()` runs after every cost write — Telegram alert at 80%, critical at 95%
3. A/B variant only generated if `(today_spend + $16) < $75`

---

## 10. Error Handling Strategy

| Error | Detection | Response | Recovery |
|-------|-----------|----------|----------|
| Missing env var | Zod at startup | EXIT 1 + Telegram alert | Operator adds var, restart |
| Budget cap | `daily_budget_log` query | ABORT production | Auto-resets next calendar day |
| API 5xx | HTTP status in `withRetry()` | Exponential backoff × 3, then fallback | Auto-recovers next run |
| API 429 rate limit | HTTP 429 status | Immediate fallback (no retry) | Fallback vendor used |
| Gate 4/7 hard fail | Gate runner result | Abort publish, log, alert | Operator investigates |
| Gate 1–3/5–6 soft fail | Gate runner result | Retry once; mark degraded on 2nd fail | Degraded scenes still used |
| All scenes failed | 0 accepted scenes | Abort video, mark `failed` | Investigate vendor health |
| Supabase down | ECONNREFUSED | SQLite fallback; `syncLocalToSupabase()` on recovery | Automatic on next success |
| FFmpeg error | Non-zero exit code | Log full stderr; retry once | If retry fails, skip scene |
| Uncaught exception | `process.on('uncaughtException')` | Log + Telegram alert + graceful exit | Restart on next cron trigger |

---

## 11. Security Model

### Secret Management
- All credentials in `.env` only — never in source files
- `.env` excluded by `.gitignore`
- `src/config.ts` uses Zod to validate presence; never logs values
- Supabase service key (never anon key) used for all DB ops

### PII Handling
- Email addresses stored as SHA-256 hashes only (`newsletter_signups.email_hash`)
- `gdpr_deletion_log` uses hashed subject identifiers
- No viewer data collected

### Content Safety
- Gate 4 blocks any content policy / DMCA violation before publish
- All voice is synthesized (no audio sampling of copyrighted material)
- Background music from pre-cleared `assets/music/` only
- Emergency takedown: `npm run emergency-takedown -- --video-id <id>`
  - Deletes from YouTube, TikTok, Instagram via platform APIs
  - Strips audio from stored file if `--reason dmca`
  - Writes to `takedown_log`
  - Sends Telegram alert

---

## 12. WSL2 Integration Notes

### Path Conventions

```
Inside Node.js / FFmpeg (WSL2 paths):
  /tmp/cryptidvlog/                     Scratch space
  /tmp/cryptidvlog/scenes/{id}/         Per-scene working dir
  /tmp/cryptidvlog/videos/{id}/         Per-video assembly dir
  /tmp/cryptidvlog/fallback.db          SQLite fallback database

Windows project root (accessible from both sides):
  Windows:  C:\Users\lmand\Downloads\cryptidvlog\
  WSL2:     /mnt/c/Users/lmand/Downloads/cryptidvlog/

Write tool (Claude Code):
  Uses Windows path — C:/Users/lmand/Downloads/...
  DO NOT use /tmp/ paths with Write tool (different filesystem from bash)
```

### Windows Task Scheduler Bridge

```
Task Scheduler fires wsl.exe daily at 07:00:
  Program:   wsl.exe
  Arguments: -d Ubuntu -e bash -c
             "cd /mnt/c/Users/lmand/Downloads/cryptidvlog &&
              npm run dev >> /tmp/cryptidvlog/logs/cron.log 2>&1"

Alternatively, WSL2 cron (requires WSL2 already running):
  0 7 * * * cd /mnt/c/Users/lmand/Downloads/cryptidvlog && npm run dev
```

### FFmpeg

```
Installed inside WSL2 Ubuntu: sudo apt install ffmpeg
Node.js (fluent-ffmpeg) uses WSL2 FFmpeg automatically.
Override paths in .env if needed:
  FFMPEG_PATH=/usr/bin/ffmpeg
  FFPROBE_PATH=/usr/bin/ffprobe
```

---

## 13. Configuration Reference

All variables loaded from `.env`. `src/config.ts` validates with Zod at startup.

### AI Providers

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | claude-sonnet-4-6 (primary text + vision) |
| `OPENAI_API_KEY` | Yes | GPT-4o fallback + OpenAI TTS |
| `FAL_API_KEY` | Yes | fal.ai Veo 3.1 video generation |
| `ELEVENLABS_API_KEY` | Yes | Character voice synthesis |
| `CARTESIA_API_KEY` | No | Tier 1 voice fallback |
| `ELEVENLABS_YETI_VOICE_ID` | Yes | Yeti character voice clone ID |
| `ELEVENLABS_BIGFOOT_VOICE_ID` | Yes | Bigfoot character voice clone ID |

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | — | Service role key (server-side only) |

### Monitoring

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram Bot API token |
| `TELEGRAM_CHAT_ID` | Yes | Chat/channel ID for alerts |

### Publishing

| Variable | Required | Description |
|----------|----------|-------------|
| `YOUTUBE_CLIENT_ID` | Yes | YouTube OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | Yes | YouTube OAuth client secret |
| `YOUTUBE_REFRESH_TOKEN` | Yes | YouTube OAuth refresh token |
| `TIKTOK_CLIENT_KEY` | Yes | TikTok app client key |
| `TIKTOK_ACCESS_TOKEN` | Yes | TikTok access token |
| `INSTAGRAM_ACCESS_TOKEN` | Yes | Instagram Graph API token |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Yes | Instagram business account ID |
| `BLOTATO_API_KEY` | No | Blotato multi-platform scheduler (optional) |

### Pipeline Config

| Variable | Default | Description |
|----------|---------|-------------|
| `BUDGET_HARD_CAP` | `75` | Daily hard cap in USD |
| `BUFFER_MAX` | `5` | Skip generation when approved queue >= this |
| `BUFFER_EXTENDED_DAYS` | `2` | Buffer threshold during vendor outage |
| `LOG_LEVEL` | `info` | Winston log level |
| `LOG_FORMAT` | `text` | `text` or `json` |
| `NODE_ENV` | `development` | `production` enables stricter enforcement |
| `STORAGE_BUCKET` | `cryptidvlog-videos` | Supabase storage bucket |
| `STORAGE_LOCAL_PATH` | `/tmp/cryptidvlog` | WSL2 scratch path |

---

*End of DESIGN.md — Cryptid Vlog AI Pipeline v1.0*
