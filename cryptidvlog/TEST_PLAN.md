# Cryptid Vlog — Test Plan

## Overview

Three test layers: **unit** (isolated module behavior), **integration** (cross-module wiring), **end-to-end** (full pipeline with all external calls mocked).

| Layer | Tool | Mocking |
|-------|------|---------|
| Unit | Vitest | msw (HTTP), vi.mock (modules) |
| Integration | Vitest | msw |
| E2E | Vitest | msw + SQLite test DB |

**Coverage targets:** 80% statements overall; 90% for gate files.

---

## Unit Tests

### `tests/unit/utils/`

#### `logger.test.ts`
- `info()` writes to stdout with `[INFO]` prefix
- `warn()` writes to stderr
- `error()` writes to stderr
- JSON format includes `level`, `msg`, `ts` fields as valid JSON
- Log level `error` suppresses `info` and `warn` output

#### `retry.test.ts`
- Retries up to `maxAttempts` on transient Error
- Exponential backoff delay doubles each attempt (mock `setTimeout`)
- `NonRetryableError` skips all retries, throws immediately
- Returns result on first success without extra calls
- Throws last error after exhausting all attempts

#### `hash.test.ts`
- `hashEmail("test@test.com")` returns 64-char hex string
- `hashEmail` normalizes to lowercase before hashing (A@B.com == a@b.com)
- `hashFile(path)` returns SHA-256 of file contents
- `hashString` is deterministic across calls

---

### `tests/unit/config.test.ts`
- Throws descriptive error listing missing var name when required env var absent
- `BUDGET.hardCap` parses `"75"` as number `75`
- `CHARACTER_VOICE_RANGES.yeti` = `{ min: 170, max: 290 }`
- `CHARACTER_VOICE_RANGES.bigfoot` = `{ min: 80, max: 180 }`
- `CONSISTENCY.rejectBelow` = 70
- `CONSISTENCY.saveAbove` = 95

---

### `tests/unit/gates/`

#### `gate1-consistency.test.ts`
- Returns `score` as integer 0–100
- `score >= 95` → `savedAsReference: true`, frame save triggered
- `score < 70` → `pass: false`
- `score >= 70` → `pass: true`
- Passes correct `VisionInput` with frame images to `runVisionAnalysis`
- API timeout → returns `{ pass: false, score: 0 }`, logs error (doesn't throw)

#### `gate2-continuity.test.ts`
- Pass when Claude reports frames visually match
- Fail when Claude detects discontinuity — `reason` populated
- Skipped for first scene (no previous frame)
- Returns `{ pass: boolean, reason: string }`

#### `gate3-face.test.ts`
- Pass when body visible in > 50% of frames
- Fail when body not detected in majority
- Does not fail on partial occlusion (≥ 30% body visible counts as present)

#### `gate4-policy.test.ts`
- `containsCopyrightedAudio: true` → `pass: false` (hard fail)
- `harmfulContent: true` → `pass: false` (hard fail)
- Clean script + audio → `pass: true`, empty `flags`
- Returns structured `{ pass, containsCopyrightedAudio, harmfulContent, flags }`

#### `gate5-voice.test.ts`
- MOS ≥ 0.8 → `pass: true`
- MOS < 0.8 → `pass: false`
- Voice frequency within character range → `inRange: true`
- Calls retry once on fail before returning final result

#### `gate6-crop.test.ts`
- All UI elements within 9:16 safe zone → `pass: true`
- Text bleeding outside → `pass: false`, `cropCoordinates` returned
- `cropCoordinates` covers the safe area correctly

#### `gate7-watermark.test.ts`
- Watermark present, disclosure present → `pass: true`
- Watermark missing → `pass: false`, `watermarkFound: false`
- Disclosure missing → `pass: false`, `disclosureFound: false`

---

### `tests/unit/ai/`

#### `claude.test.ts`
- `runVisionAnalysis` returns Claude response text (msw mock)
- Falls back to GPT-4o when Anthropic returns 503
- Does NOT fall back on Anthropic 400 (client error — not a vendor outage)
- `runTextAnalysis` same fallback behavior

#### `veo.test.ts`
- `generateSceneClip` calls fal.ai API with correct `prompt` field
- Falls back to Replicate on fal.ai 503
- Falls back to slideshow when both fal.ai and Replicate fail
- Slideshow generates a valid MP4 path from reference images

#### `voice.test.ts`
- `synthesizeNarration` calls ElevenLabs with correct voice ID for character
- Falls back to Cartesia on ElevenLabs 503
- Falls back to OpenAI TTS when both ElevenLabs and Cartesia fail
- Returns audio file path on success

---

### `tests/unit/db/`

#### `costs.test.ts`
- `recordSceneCost` inserts row to `scene_costs` with correct fields
- `getDailySpend("2026-02-21")` returns sum for that date
- `checkBudgetCap()` returns `true` when spend < $75
- `checkBudgetCap()` returns `false` when spend >= $75
- `alertIfNearCap(60)` sends alert (80% = $60/$75)
- `alertIfNearCap(71.50)` sends critical alert (95%)
- `alertIfNearCap(40)` sends no alert (< 80%)

#### `characters.test.ts`
- `getCharacter('yeti')` returns seeded record
- `getCharacter('bigfoot')` returns seeded record
- `getCharacter('unknown')` returns `null`
- `saveConsistencyScore` inserts correct record
- `getActiveReferences('yeti')` returns only `is_active = true` rows
- `saveReferenceFrame` inserts when `consistencyScore >= 95`
- `saveReferenceFrame` skips insert when `consistencyScore < 95`

#### `memory.test.ts`
- `getCharacterInteractions(videoId)` returns interactions for that video only
- `validateMemoryIntegrity` passes when no callbacks in script
- `validateMemoryIntegrity` passes when callback references real episode in DB
- `validateMemoryIntegrity` fails when callback references non-existent episode
- Claude parse failure in `validateMemoryIntegrity` → returns `{ valid: true }` (non-blocking)

---

### `tests/unit/media/`

#### `ffmpeg.test.ts`
- `concatenateScenes` invokes ffmpeg with concat demuxer args
- `mixAudio` applies `-18dB` volume filter to music track
- `applyCropSafeZone` crops to 9:16 aspect ratio
- `burnWatermark` adds drawtext filter at bottom-right
- Returns output path on success
- Throws on non-zero ffmpeg exit code

#### `frames.test.ts`
- `extractFrames` calls ffmpeg with `-vf fps=1`
- `getBestFrame` returns path of sharpest frame (mocked sharp scores)
- `frameToBase64` returns base64 string from file buffer

#### `audio.test.ts`
- `stripAudioTrack` calls ffmpeg with `-an` flag
- `normalizeAudio` applies `loudnorm` filter
- Both return output path on success

---

### `tests/unit/monitoring/`

#### `costs.test.ts`
- `trackCost` calls `recordSceneCost` with correct fields
- `trackCost` calls `alertIfNearCap` after recording

#### `buffer.test.ts`
- `isBufferHealthy()` returns `true` when depth >= 5
- `isBufferHealthy()` returns `false` when depth < 5
- `checkAndAlertBuffer()` sends critical alert when depth <= 1
- `checkAndAlertBuffer()` sends warning when depth <= 2
- `checkAndAlertBuffer()` sends no alert when depth > 2

#### `vendor-health.test.ts`
- `pollVendorHealth` writes one `vendor_health_log` row per vendor
- Status `'down'` written when status page unreachable (network error)
- Status `'degraded'` written when latency > 4000ms
- Status `'healthy'` written on fast successful response
- Telegram alert sent for `down` and `degraded`; not sent for `healthy`

---

### `tests/unit/pipeline/`

#### `ideator.test.ts`
- Returns `Concept` with all required fields
- Uses queued concept when `concept_injection_queue` has pending items
- Auto-generates via Claude when queue is empty
- A/B priority score computed correctly (new archetype +30, trending +25, series opener +20)

#### `scriptwriter.test.ts`
- Returns `SceneScript[]` with length matching `concept.sceneCount`
- Each script has `narration`, `dialogue`, `visualDirection`
- Calls `validateMemoryIntegrity` before generating scripts
- Throws when `validateMemoryIntegrity` returns `valid: false`

#### `producer.test.ts`
- Calls `generateSceneClip` and `synthesizeNarration` per scene
- Runs Gate 1, Gate 2, Gate 3 per scene
- Retries scene once on gate failure
- Marks scene `degraded` after retry fail (doesn't abort remaining scenes)

#### `assembler.test.ts`
- Calls `concatenateScenes → mixAudio → applyCropSafeZone → burnWatermark` in order
- Returns `AssembledVideo` with `videoPath` and `durationSeconds`

#### `publisher.test.ts`
- Calls YouTube, TikTok, Instagram uploaders
- All uploads include `syntheticMediaLabeled: true`
- Handles partial failure gracefully (2 platforms succeed, 1 fails → logs error)
- Returns `failures: ['tiktok']` for failed platform

---

## Integration Tests

### `tests/integration/gate-pipeline.test.ts`
- Full 7-gate run on pre-rendered test scene passes all gates
- Gate 4 positive flag aborts remaining gates immediately
- Gate 7 missing watermark → `hardFail: true`, `pass: false`
- Gate runner result has per-gate results object

### `tests/integration/media-pipeline.test.ts`
- `concat → mixAudio → cropSafeZone → burnWatermark` on real test clips produces valid MP4
- Output duration matches sum of input clips (within 1 second)
- Watermark detected in sampled output frames via sharp

### `tests/integration/db-fallback.test.ts`
- `dbInsert` succeeds via SQLite when Supabase mocked as ECONNREFUSED
- `pending_sync` table populated with queued write
- `syncLocalToSupabase` clears `pending_sync` when Supabase recovered (mocked)
- Telegram alert sent exactly once per outage (not per failed call)

### `tests/integration/ab-test.test.ts`
- A/B variant generated only when `abEligible: true` AND budget allows
- Variant links to base via `ab_parent_id`
- Both base and variant sent as separate Telegram review messages
- A/B result record written after metrics comparison

### `tests/integration/vendor-fallback.test.ts`
- Claude 503 → GPT-4o used (msw: mock Anthropic 503, OpenAI 200)
- ElevenLabs 503 → Cartesia used
- fal.ai 503 → Replicate used
- fal.ai + Replicate both 503 → slideshow generates valid output
- All voice vendors 503 → scene aborts gracefully (no unhandled rejection)

---

## End-to-End Tests

All E2E tests run with all external HTTP calls mocked via msw and a fresh SQLite test DB.

### `tests/e2e/happy-path.test.ts`
**Setup:** All vendors mocked healthy; one concept in queue; budget at $0.

**Expected:**
- 4 scenes generated, all gates pass
- Final video assembled
- Telegram review request sent with correct fields
- `videos` record: `status = 'pending_review'`
- `daily_budget_log` entry created with cost < $35

### `tests/e2e/vendor-outage.test.ts`
**Setup:** fal.ai returns 503 for scene 2 only; Replicate returns 200.

**Expected:**
- Scene 2 uses Replicate fallback
- Pipeline completes with all 4 scenes
- Telegram alert: "fal.ai failed — trying Replicate" (or similar)

### `tests/e2e/complete-outage.test.ts`
**Setup:** fal.ai + Replicate both 503 for all scenes.

**Expected:**
- All scenes use slideshow fallback
- Telegram alert: "All video vendors down — using slideshow fallback"
- Video assembled from slideshows
- Gate 1 scores may be degraded (slideshow expected behavior)

### `tests/e2e/budget-cap.test.ts`
**Setup:** `daily_budget_log` already shows $75.00 for today.

**Expected:**
- Pipeline exits at budget check
- No video records created
- No API calls made
- Log message: "Daily hard cap reached"

### `tests/e2e/empty-queue.test.ts`
**Setup:** `concept_injection_queue` is empty.

**Expected:**
- Ideator auto-generates concept via Claude
- Pipeline continues normally
- No queue record created for auto-generated concept

### `tests/e2e/gate-retry.test.ts`
**Setup:** Gate 5 (voice) mocked to fail once, pass on retry.

**Expected:**
- Scene retried once for voice
- Second attempt passes gate 5
- `scenes.retry_count = 1` for that scene
- Final video assembled with retried audio

### `tests/e2e/zero-scenes.test.ts`
**Setup:** All scene generation fails (all vendors 503).

**Expected:**
- Pipeline aborts after producer stage
- `videos.status = 'failed'`
- Telegram error alert sent
- No video assembled or published

---

## Cost Regression Tests (`tests/cost-regression.test.ts`)

Validates budget math stays correct across code changes.

- Standard 4-scene video: $18–$25 total
- A/B variant adds ≤ $16
- Retry reserve ≤ $8
- `video_gen + voice + ai + ab ≤ hard_cap - retry_reserve` always holds
- Budget math: hard cap $75, retry $8 → max normal spend = $67

---

## Compliance Tests (`tests/compliance/`)

### `gdpr.test.ts`
- `processDeletionRequest(emailHash)` removes row from `newsletter_signups`
- `gdpr_deletion_log` written with `completed_at` timestamp
- Does not delete video content (only PII rows)

### `dmca-takedown.test.ts`
- `emergencyTakedown(videoId)` calls delete API on all 3 platforms
- `videos.status` set to `'taken_down'`
- `takedown_log` row written with platforms and timestamp
- `audio_stripped: true` when `reason` contains "DMCA"
- Telegram alert sent on completion

### `synthetic-media-labels.test.ts`
- YouTube upload payload includes `selfDeclaredMadeForKids: false`
- TikTok upload payload includes `brand_content_toggle: true`
- Instagram upload caption includes AI disclosure text
- All uploads have `synthetic_media_labeled: true` in `platform_publishes`

---

## Performance Targets

| Benchmark | Target |
|-----------|--------|
| Gate 1 (single vision call) | < 8 s |
| Gate 4 (policy check) | < 5 s |
| Full 7-gate pipeline | < 30 s |
| Full E2E run (mocked vendors) | < 15 min |
| `getDailySpend` DB query | < 100 ms |

---

## Running Tests

```bash
# All unit tests
npm test

# With coverage report
npm run test:coverage

# Integration only
npm run test:integration

# E2E only
npm run test:e2e

# Watch mode (development)
npm run test:watch

# Single file
npx vitest run tests/unit/gates/gate1-consistency.test.ts
```
