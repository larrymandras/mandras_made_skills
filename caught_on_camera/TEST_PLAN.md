# Caught on Camera — Test Plan

## Overview

Three test layers: **unit** (isolated module behavior), **integration** (cross-module wiring with mocked external calls), **end-to-end** (full pipeline with all HTTP mocked via msw and SQLite test DB).

| Layer | Tool | Mocking strategy |
|-------|------|-----------------|
| Unit | Vitest | `vi.mock()` for modules, `msw` for HTTP |
| Integration | Vitest | `msw` for HTTP, real FFmpeg for media tests |
| E2E | Vitest | `msw` + SQLite test DB, no real API calls |
| Cost regression | Vitest | Checks budget math, no API calls |
| Compliance | Vitest | Validates metadata and watermark presence |

**Coverage targets:** 80% statements overall; 90% for all gate files (`src/gates/`).

---

## Running Tests

```bash
# All unit tests
npm test

# Unit tests only (fast, no I/O)
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests (msw + SQLite)
npm run test:e2e

# Cost regression suite
npm run test:cost

# Compliance suite
npm run test:compliance

# With coverage report
npm run test:coverage

# Watch mode (development)
npm run test:watch

# Single file
npx vitest run tests/unit/gates/gate1-motion.test.ts

# Single test by name pattern
npx vitest run --reporter=verbose -t "ring_cam with avgMotion=0.3"
```

---

## Unit Tests

### `tests/unit/utils/`

#### `logger.test.ts`
- `logger.info()` writes to stdout with `[INFO]` prefix
- `logger.warn()` writes to stderr
- `logger.error()` writes to stderr with `[ERROR]` prefix
- JSON log format includes `level`, `msg`, `ts` fields as valid JSON
- Log level `error` suppresses `info` and `warn` output
- Log level `debug` outputs all levels
- Structured metadata object is serialized into log output

#### `retry.test.ts`
- Retries up to `maxAttempts` on transient Error
- Exponential backoff delay doubles each attempt (mock `setTimeout`)
- Does not retry on a permanently-failing error if caller uses the non-retryable path
- Returns result on first success without extra calls
- Throws last error after exhausting all attempts
- Delay does not execute if first attempt succeeds

#### `hash.test.ts`
- `hashString("hello")` returns 64-character lowercase hex string
- `hashString` is deterministic across identical inputs
- `hashString` produces different output for different inputs
- `hashFile(path)` reads file and returns SHA-256 hex string
- `hashFile` throws descriptive error if file does not exist

---

### `tests/unit/config.test.ts`
- Throws descriptive error listing missing var name when required env var absent
- `BUDGET.hardCap` equals 50 (default) when `DAILY_BUDGET_HARD_CAP` not set
- `BUDGET.warning` equals 40 (default)
- `BUDGET.target` equals 25 (default)
- `MOTION_THRESHOLDS.ringCam.maxAvg` equals 0.5
- `MOTION_THRESHOLDS.bodyCam.minAvg` equals 1.5
- `AUDIO_THRESHOLDS.silenceDb` equals -40
- `PLATFORM_LIMITS.youtube.maxPerDay` equals 2
- `PLATFORM_LIMITS.tiktok.maxPerDay` equals 3
- `FORMAT_SCHEDULE` parses default correctly — Monday is `ring_cam`
- `FORMAT_SCHEDULE` parses JSON string from env var when set
- `ENABLE_POLICE_SUBTYPE` defaults to `true`; string `"false"` → boolean `false`
- `BODY_CAM_SUB_TYPES` array includes all 4 sub-types: `police_security`, `hiker_trail`, `dashcam`, `helmet_action`

---

### `tests/unit/gates/`

#### `gate1-motion.test.ts`
**Ring cam scenarios:**
- `avgMotion=0.3` → `{ pass: true, action: null }` (well within static threshold)
- `avgMotion=0.5` → `{ pass: true, action: null }` (exactly at threshold, inclusive)
- `avgMotion=0.6` → `{ pass: false, action: 'regenerate' }` (over threshold)
- `avgMotion=0.8` → `{ pass: false, action: 'regenerate', reason: 'too much motion for ring cam' }`
- Spike motion `maxSpike=3.0` with `avgMotion=0.4` → `{ pass: false, action: 'regenerate' }` (spike over 2.0)

**Body cam scenarios:**
- `avgMotion=2.0` → `{ pass: true, action: null }` (sufficient motion)
- `avgMotion=1.5` → `{ pass: true, action: null }` (exactly at threshold, inclusive)
- `avgMotion=0.8` → `{ pass: false, action: 'add_shake', reason: 'insufficient motion for body cam' }`
- `avgMotion=0.4` → `{ pass: false, action: 'add_shake' }` (very static body cam)

**Implementation:**
- Calls FFmpeg motion analysis on video file (mocked in unit tests)
- Returns typed `Gate1Result` with `pass`, `action`, `avgMotion`, `maxSpike`, `reason?`

#### `gate2-face.test.ts`
- No faces detected → `{ pass: true, facesFound: 0, outputPath: originalPath }` (no blur needed)
- 1 face detected → `{ pass: true, facesFound: 1, outputPath: '<blurred_path>' }` (blur applied)
- 3 faces detected → `{ pass: true, facesFound: 3, outputPath: '<blurred_path>' }`
- Gate 2 always returns `pass: true` — it transforms, never rejects
- `outputPath` is different from input path when blur was applied
- `outputPath` equals input path when no blur was needed
- Face detection API failure → returns `{ pass: true, facesFound: 0, outputPath: originalPath, error: 'detection_failed' }` (fails open for transform gate)

#### `gate3-audio.test.ts`
**Ring cam scenarios:**
- `meanVolume=-20dB` → `{ pass: true, action: null }` (within -40 to -10 range)
- `meanVolume=-50dB` (silent) → `{ pass: false, action: 'regenerate', reason: 'audio below silence floor' }`
- `meanVolume=-5dB` (too loud) → `{ pass: false, action: 'replace_audio', reason: 'audio exceeds ring cam max' }`
- `meanVolume=-40dB` (exactly at silence floor) → `{ pass: false, action: 'regenerate' }` (floor is exclusive)

**Body cam scenarios:**
- `meanVolume=-25dB` → `{ pass: true, action: null }` (within -35 to -10 range)
- `meanVolume=-30dB` → `{ pass: true, action: null }` (within range)
- `meanVolume=-40dB` → `{ pass: false, action: 'mix_bed', reason: 'body cam audio below floor' }`
- `meanVolume=-5dB` → `{ pass: false, action: 'replace_audio' }` (too loud for both formats)

**Implementation notes:**
- Uses FFmpeg `volumedetect` filter: `ffmpeg -i video.mp4 -af volumedetect -f null /dev/null`
- Parses `mean_volume` from stderr output
- Returns typed `Gate3Result` with `pass`, `action`, `meanVolume`, `maxVolume`, `reason?`

#### `gate4-policy.test.ts`
**sanitizePrompt() — Stage A (pre-generation):**
- Prompt containing `"arrest"` → `{ pass: false, blockedWords: ['arrest'], sanitized: null }`
- Prompt containing `"child"` → `{ pass: false, blockedWords: ['child'], sanitized: null }`
- Prompt containing `"use of force"` → `{ pass: false, blockedWords: ['use of force'], sanitized: null }`
- Prompt containing `"weapon"` → `{ pass: false, blockedWords: ['weapon'], sanitized: null }`
- Prompt containing `"chase"` → `{ pass: true, rewrites: [{ original: 'chase', replacement: 'rapid movement toward' }], blockedWords: [] }`
- Prompt containing `"police officer"` → `{ pass: true, rewrites: [{ original: 'police officer', replacement: 'security patrol person' }] }`
- Prompt containing `"ghost"` → `{ pass: true, rewrites: [{ original: 'ghost', replacement: 'dark shadow figure' }] }`
- Clean prompt → `{ pass: true, rewrites: [], blockedWords: [], sanitized: <originalPrompt> }`
- Multiple blocked words → all listed in `blockedWords`
- Blocked word inside rewrite candidate → blocked wins, pass: false

**runGate4() — Stage B (post-generation content review):**
- Claude returns `severity: 'critical'` → `{ pass: false, hardFail: true, severity: 'critical' }`
- Claude returns `severity: 'high'` → `{ pass: false, hardFail: true, severity: 'high' }`
- Claude returns `severity: 'medium'` → `{ pass: false, hardFail: false, severity: 'medium' }`
- Claude returns `severity: 'none'` → `{ pass: true, hardFail: false, severity: 'none', flags: [] }`
- Claude API failure (network error) → `{ pass: false, hardFail: false, severity: 'medium', flags: ['review_api_error'] }` (fail safe)
- Flags array accurately reflects content types found (faces_present, violence, etc.)

#### `gate5-crop.test.ts`
- Main subject visible and centered in 9:16 safe zone → `{ pass: true, cropSafe: true }`
- Main subject in center but partially at edge → `{ pass: true, cropSafe: true }` (partially visible is OK)
- Main subject action occurs entirely off-center (left third, not in 9:16 crop) → `{ pass: false, cropSafe: false, youtubeOnly: true }`
- Text or critical overlay cut off in 9:16 crop → `{ pass: false, cropSafe: false }`
- Gate 5 failure sets `youtubeOnly: true` — limits platform distribution but does not abort pipeline

#### `gate6-overlay.test.ts`
- Overlay frame detected in sampled keyframe → `{ pass: true, overlayDetected: true }`
- No overlay detected in any keyframe → `{ pass: false, overlayDetected: false, hardFail: true }` (hard fail)
- Overlay partially rendered / corrupted → `{ pass: false, overlayDetected: false, hardFail: true }`
- Claude vision API failure → `{ pass: false, overlayDetected: false, reason: 'vision_api_error' }` (hard fail — fail safe)

#### `gate7-disclosure.test.ts`
- `burnDisclosure(videoPath)` produces output file with `_watermarked` suffix
- Output file contains visible "AI GENERATED" watermark in bottom-right (checked via frame sample)
- Output file is valid MP4 (FFprobe returns exit 0)
- `runGate7(watermarkedPath)` → Claude vision confirms watermark → `{ pass: true, watermarkFound: true, disclosureFound: true }`
- `runGate7(unwatermarkedPath)` → watermark absent → `{ pass: false, watermarkFound: false, hardFail: true }`
- `runGate7(watermarkedPath)` → disclosure text absent (only watermark burned) → `{ pass: false, disclosureFound: false, hardFail: true }`
- Gate 7 failure always sets `hardFail: true` — this gate cannot be soft-failed or skipped

---

### `tests/unit/ai/`

#### `claude.test.ts`
- `analyzeFrames(frames, prompt)` calls Anthropic API and returns response text (msw mock: HTTP 200)
- `analyzeFrames` falls back to no-op/error when Anthropic returns 503 (or throws retryable error)
- `runTextAnalysis(prompt)` returns Claude text response (msw mock)
- API timeout → `runTextAnalysis` re-throws with descriptive message

#### `veo.test.ts`
- `generateVideo(prompt, format)` calls fal.ai API with correct `prompt` field
- Returns `{ videoPath: string, costUsd: number }` on success
- fal.ai returns 401 → throws non-retryable auth error
- fal.ai returns 429 (rate limit) → retries with exponential backoff

---

### `tests/unit/db/`

#### `costs.test.ts`
- `checkBudget()` at $0 spend → `{ canGenerate: true, atWarning: false, atCap: false }`
- `checkBudget()` at $25 spend → `{ canGenerate: true, atWarning: false, atCap: false }`
- `checkBudget()` at $40 spend → `{ canGenerate: true, atWarning: true, atCap: false }`
- `checkBudget()` at $50 spend → `{ canGenerate: false, atWarning: true, atCap: true }`
- `checkBudget()` at $51 spend → `{ canGenerate: false, atCap: true }` (already over)
- `getDailySpend(date)` returns 0 when no costs recorded for that date
- `recordSceneCost(videoId, costUsd)` inserts row to `scene_costs` with correct fields

#### `ideas.test.ts`
- `getNextRingCamIdea()` returns highest virality_score pending ring_cam idea
- `getNextRingCamIdea()` returns null when no pending ring_cam ideas exist
- `getNextBodyCamIdea(enablePolice=false)` never returns `police_security` sub-type idea
- `getNextBodyCamIdea(enablePolice=true)` may return any sub-type including `police_security`
- `markIdeaInProduction(id)` updates status to `in_production`
- `markIdeaDone(id)` updates status to `done`
- `markIdeaRejected(id, reason)` updates status to `rejected` with reason

#### `videos.test.ts`
- `createVideo(idea)` inserts row to `videos` with `status: 'generating'`
- `updateVideoStatus(id, status)` updates status field
- `getVideo(id)` returns video record or null
- `getPendingReviewVideos()` returns only `status='pending_review'` rows
- `approveVideo(id)` sets `status='approved'` and `approved_at`
- `rejectVideo(id, reason)` sets `status='rejected'` and `rejection_reason`

---

### `tests/unit/pipeline/`

#### `format-schedule.test.ts`
- `getFormatForToday()` returns `ring_cam` for Monday (day 1)
- `getFormatForToday()` returns `body_cam` for Tuesday (day 2)
- `getFormatForToday()` returns `ring_cam` for Friday (day 5)
- `getFormatForToday()` returns `operator_choice` for Sunday (day 0)
- `canPublishToday('youtube')` returns true when under `maxPerDay` limit
- `canPublishToday('youtube')` returns false when at or over `maxPerDay` limit
- `canPublishToday('tiktok')` enforces separate TikTok limit (3/day)
- `generateCompliantMetadata(video, 'youtube')` always includes `selfDeclaredMadeForKids: false`
- `generateCompliantMetadata(video, 'tiktok')` includes `aigcDescription: 'ai_generated'`
- `generateCompliantMetadata(video, platform)` always includes `isAiGenerated: true` for all platforms
- Metadata description/caption always includes AI disclosure text phrase

#### `dedup.test.ts`
- `isRingCamDuplicate(candidate)` returns `true` for idea with high semantic similarity to existing
- `isRingCamDuplicate(candidate)` returns `false` for clearly different concept
- `isBodyCamDuplicate(candidate)` behaves equivalently for body_cam ideas
- `isCrossFormatDuplicate(candidate, 'body_cam')` returns `true` when similar ring_cam idea exists
- Same title (exact match) → always `isDuplicate: true`
- Same category appearing 4× in a row → `categoryExhausted: true` from `checkCategoryRotation()`

---

## Integration Tests

### `tests/integration/pipeline/gate-pipeline.test.ts`
- Full 7-gate pipeline with mocked FFmpeg and mocked Claude: clean fixture video passes all gates
- Gate 4 hard fail (prompt contains blocked word): gates 5, 6, 7 do NOT run (short-circuit)
- Gate 4 hard fail (post-gen high severity): remaining gates do NOT run
- Gate 7 missing watermark → `{ hardFail: true, pass: false }` — pipeline aborts
- Gate runner result `GatePipelineResult` contains per-gate results object with all 7 keys
- Gate 1 `add_shake` action: shake filter applied to body_cam clip, gate 1 re-run → passes
- Gate 3 `mix_bed` action: audio bed mixed into clip, gate 3 re-run → passes
- Gate 2 transform: blurred output path stored in pipeline state for subsequent gates

### `tests/integration/pipeline/media-pipeline.test.ts`
- Ring cam degradation → overlay compositing → gate 7 watermark burn → produces valid MP4 at 1920x1080
- Body cam degradation with shake → overlay compositing → gate 7 watermark burn → produces valid MP4 at 1920x1080
- 9:16 vertical output generated from 16:9 master via center crop → valid MP4 at 1080x1920
- Gate 7 watermark detectable in sampled output frame via pixel analysis or Claude vision check
- FFmpeg non-zero exit → pipeline throws with descriptive error message

### `tests/integration/pipeline/dedup-db.test.ts`
- Dedup check against SQLite test DB: planting a near-duplicate idea prevents it from being generated
- Semantic dedup works across separate ideator runs (persisted in DB, not just in-memory)
- Cross-format dedup: ring_cam idea with matching title blocks body_cam idea with same core concept

### `tests/integration/pipeline/budget-integration.test.ts`
- Budget hard cap blocks production at $50: `canGenerate=false` returned before Veo API is called
- Budget at $39 (under warning): pipeline proceeds without alert
- Budget at $41 (over warning): Telegram warning alert sent (mocked Telegram endpoint receives request)
- Budget at $50 exactly: pipeline aborts; 0 fal.ai API calls made (verified via msw request log)

---

## End-to-End Tests

All E2E tests use:
- `msw` (Mock Service Worker) to intercept all HTTP: Supabase, Anthropic, fal.ai, Cloudinary, Blotato, Telegram
- Fresh in-memory SQLite DB seeded per test
- Real FFmpeg for media processing (uses fixture video files)
- No real API keys consumed

### `tests/e2e/happy-path-ring-cam.test.ts`
**Setup:** All vendors mocked healthy; ring_cam idea in queue; budget at $0; Monday (ring_cam day).

**Flow:** idea → sanitize → Veo generation → degradation → 7 gates → overlay → Cloudinary upload → Telegram review message

**Expected:**
- All 7 gates pass (mocked Claude returns clean responses)
- Cloudinary upload request received (msw logs request)
- Telegram review message sent with `[RING CAM]` tag
- `videos` row: `status='pending_review'`, `format='ring_cam'`
- `scene_costs` row created with `cost_usd > 0`
- `daily_budget_log` entry created

### `tests/e2e/happy-path-body-cam-dashcam.test.ts`
**Setup:** body_cam dashcam idea in queue; budget at $0; Tuesday (body_cam day).

**Expected:**
- All 7 gates pass
- Telegram review message sent with `[BODY CAM: dashcam]` tag
- `videos` row: `format='body_cam'`, `sub_type='dashcam'`

### `tests/e2e/gate4-hard-fail-blocked-prompt.test.ts`
**Setup:** ring_cam idea with concept prompt containing `"arrest"`.

**Expected:**
- `sanitizePrompt` called before Veo generation
- `sanitizePrompt` returns `pass=false`
- fal.ai endpoint receives ZERO requests (Veo not called — cost saved)
- `ring_cam_ideas` row updated to `status='rejected'`
- Next highest-virality idea selected and proceeds through pipeline

### `tests/e2e/gate1-fail-ring-cam-regenerate.test.ts`
**Setup:** First Veo call produces clip with avgMotion=0.8 (ring cam motion too high). Second Veo call produces clip with avgMotion=0.3.

**Expected:**
- Gate 1 fails on first clip → action=`regenerate`
- Veo called a second time with reinforced static-camera prompt
- Gate 1 passes on second clip
- Final video uses second-generation clip
- `videos` row: `gate1_retries=1`

### `tests/e2e/gate1-fail-body-cam-add-shake.test.ts`
**Setup:** Veo call produces clip with avgMotion=0.4 (body cam too stable). After shake applied, avgMotion=1.8.

**Expected:**
- Gate 1 fails on raw clip → action=`add_shake`
- Shake FFmpeg filter applied (real FFmpeg operation on fixture clip)
- Gate 1 re-runs on shaken clip → passes (avgMotion now ≥ 1.5)
- Veo NOT called a second time (shake fix, not regeneration)

### `tests/e2e/gate3-fail-mix-bed.test.ts`
**Setup:** Generated body_cam clip has `meanVolume=-40dB` (below body cam floor of -35dB).

**Expected:**
- Gate 3 fails → action=`mix_bed`
- Audio bed file read from `assets/audio_beds/body_cam/`
- FFmpeg audio mix applied (real FFmpeg)
- Gate 3 re-runs on mixed clip → passes
- Output clip has non-silent audio track

### `tests/e2e/veo-api-down.test.ts`
**Setup:** fal.ai returns 503 for all requests.

**Expected:**
- fal.ai call fails
- Error logged with structured context
- Telegram alert sent: "fal.ai unavailable — video generation failed"
- `videos` row: `status='failed'`
- Pipeline aborts gracefully (no unhandled rejection)
- No orphaned temp files left in `TEMP_DIR`

### `tests/e2e/budget-cap-hit.test.ts`
**Setup:** `daily_budget_log` pre-seeded with $50.00 for today.

**Expected:**
- Pipeline pre-flight detects cap reached
- No `videos` rows created
- No fal.ai requests made
- No Veo cost incurred
- Log message: "Daily hard cap reached ($50.00)"

### `tests/e2e/blotato-down-queue.test.ts`
**Setup:** Video has been approved by Telegram; Blotato API returns 503.

**Expected:**
- Blotato publish attempt fails
- Video inserted into `manual_publish_queue` table with `status='queued'`
- Telegram alert sent: "Blotato unavailable — video queued for manual publish"
- `videos` row: `status` remains `approved` (not marked as published)
- No `platform_publishes` row created

### `tests/e2e/police-subtype-disabled.test.ts`
**Setup:** `ENABLE_POLICE_SUBTYPE=false` in test env; body_cam_ideas table contains a mix of all 4 sub-types.

**Expected:**
- Body Cam Ideator generates only `hiker_trail`, `dashcam`, `helmet_action` ideas
- Zero `police_security` ideas generated in 20 consecutive runs
- `getNextBodyCamIdea(enablePolice=false)` never returns `police_security` idea even when one exists in DB

### `tests/e2e/suppression-detected.test.ts`
**Setup:** TikTok analytics show average views dropped 65% vs prior 7 days (mocked analytics endpoint).

**Expected:**
- `checkSuppressionSignals('tiktok')` returns `{ suppressionDetected: true, platform: 'tiktok' }`
- `platform_health` row updated: `suppression_detected=true`
- `PLATFORM_LIMITS.tiktok.maxPerDay` effectively halved for subsequent `canPublishToday()` calls
- Telegram alert sent: "Possible suppression detected on TikTok — reducing posting frequency"

---

## Cost Regression Tests

### `tests/cost-regression.test.ts`

These tests validate budget math stays correct across code changes. No API calls made.

**Per-video cost bounds:**
- Ring cam single video: total cost $3–$6 (Veo + Claude gates + Cloudinary)
- Body cam single video: total cost $5–$10

**Daily budget math:**
- 3 ring cam videos: $9–$18 total — under $50 cap
- 3 body cam videos: $15–$30 total — under $50 cap
- Mixed 2 ring + 1 body cam: $11–$22 total — under $50 cap
- Worst case (3 body cam + 2 gate retries each): $15–$30 + $10–$20 = $25–$50 — at cap boundary

**Budget invariants (algebraic checks):**
- `hardCap - retryReserve >= 0` (retry reserve must not exceed cap)
- `BUDGET.hardCap === 50`
- `BUDGET.warning < BUDGET.hardCap`
- `BUDGET.target < BUDGET.warning`
- `BUDGET.retryReserve < BUDGET.hardCap - BUDGET.warning`

---

## Compliance Tests

### `tests/compliance/synthetic-media-labels.test.ts`

These tests guarantee every published video carries required AI disclosure metadata.

**Platform metadata checks:**
- `generateCompliantMetadata(video, 'youtube')` includes `selfDeclaredMadeForKids: false`
- `generateCompliantMetadata(video, 'youtube')` includes `containsSyntheticMedia: true` or equivalent
- `generateCompliantMetadata(video, 'youtube')` description includes the string "AI-generated content"
- `generateCompliantMetadata(video, 'tiktok')` includes `aigcDescription: 'ai_generated'`
- `generateCompliantMetadata(video, 'instagram')` caption includes AI disclosure phrase
- `generateCompliantMetadata(video, 'shorts')` includes `selfDeclaredMadeForKids: false`
- All platforms: returned object includes `isAiGenerated: true`

**DB compliance checks:**
- Every `platform_publishes` row inserted by `publishVideo()` has `is_ai_generated=true`
- `platform_publishes.disclosure_text` is non-empty for every row
- `platform_publishes.pinned_comment` is non-empty (AI disclosure pinned comment queued)

### `tests/compliance/watermark-presence.test.ts`

- Every video that passes gate 7 has `watermark_burned=true` in `videos` table
- `videos` rows with `status='published'` and `watermark_burned=false` do NOT exist
- Gate 7 hard fail always prevents `status='published'` from being set
- `burnDisclosure()` FFmpeg command includes `drawtext` filter with "AI GENERATED" text
- Output video frame at position `(width-200, height-50)` contains non-background pixels after `burnDisclosure()`

### `tests/compliance/police-subtype-content.test.ts`

- All `body_cam_ideas` with `sub_type='police_security'` have zero blocked terms in `concept_prompt`
- Blocked terms for police content: `arrest`, `use of force`, `handcuff`, `taser`, `pepper spray`, `traffic stop`, `pull over`, `suspect`, `perpetrator`, `excessive force`, `brutality`, `lawsuit`
- 100 consecutive `generateBodyCamIdea()` calls with police enabled: zero ideas contain any blocked term
- Gate 4 Stage A blocks police_security concept containing `"traffic stop"` before Veo call
- `ENABLE_POLICE_SUBTYPE=false` check: `generateBodyCamIdea()` called 50× → zero police_security sub-type ideas

---

## Performance Targets

| Benchmark | Target |
|-----------|--------|
| Gate 1 motion analysis (FFmpeg) | < 10 s per clip |
| Gate 2 face detection | < 8 s per clip |
| Gate 3 audio analysis (FFmpeg) | < 5 s per clip |
| Gate 4 Stage A sanitizePrompt | < 50 ms (synchronous) |
| Gate 4 Stage B content review (Claude vision) | < 10 s per clip |
| Gate 5 crop safety (Claude vision) | < 8 s per clip |
| Gate 6 overlay verification (Claude vision) | < 8 s per clip |
| Gate 7 watermark burn (FFmpeg) | < 30 s per clip |
| Full 7-gate pipeline (all gates) | < 90 s per clip |
| Full E2E run (mocked vendors) | < 5 min |
| `checkBudget()` DB query | < 100 ms |
| `getNextRingCamIdea()` DB query | < 100 ms |
