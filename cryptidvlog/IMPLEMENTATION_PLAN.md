# CRYPTID VLOG — IMPLEMENTATION PLAN

## v1.0 | February 2026 | Node.js + TypeScript + WSL2

---

## Pre-Phase Checklist (Before Any Code)

Complete all items below before Phase 1 begins. None are optional.

```
ACCOUNTS & KEYS
□ Anthropic API key (Claude claude-sonnet-4-6 access)
□ OpenAI API key (GPT-4o + TTS access)
□ fal.ai API key + Veo 3.1 access confirmed
□ Replicate API key + Veo model available
□ ElevenLabs API key + 2 voice IDs created (Yeti, Bigfoot)
□ Cartesia API key + same 2 voices cloned/created
□ Supabase project created (free tier OK for launch)
□ Blotato account + API key
□ YouTube Data API credentials (OAuth 2.0 flow completed)
□ TikTok Developer API access approved
□ Instagram Graph API access approved
□ Telegram bot created via BotFather, chat ID noted

LEGAL (from Shield_Gap_Resolutions.md Section A)
□ Media/IP attorney engaged for character IP review
□ E&O insurance quote obtained
□ Privacy Notice drafted and ready to publish
□ COPPA decision documented: "Not Made for Kids" rationale on file

CHARACTER ASSETS
□ Yeti reference images created (front, three-quarter, action pose — 1080x1920)
□ Bigfoot reference images created (same)
□ Character IP check run on both designs (scripts/ip-check.ts — Phase 1)
□ Licensed music library assembled (minimum 20 tracks, mood-tagged)

INFRASTRUCTURE
□ WSL2 installed and configured on Windows 11 machine
□ Node.js v20 LTS installed in WSL2
□ FFmpeg installed in WSL2 (sudo apt install ffmpeg)
□ rclone installed + gdrive remote configured
□ jq installed in WSL2
□ GitHub repo mandras_made_skills exists with cryptidvlog/ directory
```

---

## Dependency Graph

```
Phase 1 (Foundation)
    │
    ├── Phase 2 (AI Clients)
    │       │
    │       ├── Phase 3 (Pipeline Core)
    │       │       │
    │       │       └── Phase 4 (Quality Gates)
    │       │               │
    │       │               └── Phase 5 (Assembly & Memory)
    │       │                       │
    │       │                       └── Phase 6 (Publishing & Ops)
    │       │                               │
    │       │                               └── Phase 7 (Hardening)
    │       │
    │       └── Phase 2 also gates Phase 4 (Claude client needed for gates)
    │
    └── Phase 1 also gates Phase 6 (DB migrations needed for cost tracking)
```

All phases are strictly sequential. No phase should begin until the previous is complete and its acceptance criteria are met.

---

## PHASE 1 — Foundation
**Duration:** 4–5 days | **Weeks:** 1–2

### Goals
Establish the project skeleton, database, environment validation, and the single legally-required gate (disclosure watermark) before any other work begins.

### Tasks

**1.1 Project initialization**
- [ ] Clone `mandras_made_skills` repo locally into WSL2
- [ ] Create `cryptidvlog/` directory (already in repo from scaffold commit)
- [ ] Run `npm install` — verify all dependencies resolve
- [ ] Run `npm run typecheck` — verify zero TypeScript errors in stubs
- [ ] Confirm `vitest` runs and finds test files (0 tests pass, that's fine)

**1.2 Environment setup**
- [ ] Copy `.env.example` → `.env`, fill in all 13+ API keys
- [ ] Run `npm run check-env` — confirm all pass
- [ ] Verify FFmpeg: `ffmpeg -version` in WSL2
- [ ] Verify rclone: `rclone lsd gdrive:` lists Drive root

**1.3 Database migrations**
- [ ] Run `npm run setup-db` to apply all 5 migrations in order
- [ ] Verify tables exist in Supabase dashboard: videos, scenes, characters, scene_costs, vendor_health_log (spot-check)
- [ ] Confirm seed data: characters table has yeti + bigfoot rows

**1.4 Character IP check (one-time, legal gate)**
- [ ] Implement `scripts/ip-check.ts` — loads reference images, runs Claude vision IP check
- [ ] Run `npm run ip-check` for Yeti and Bigfoot
- [ ] If HIGH risk returned: modify reference images and re-run before proceeding
- [ ] Insert results into `character_ip_registry` table
- [ ] Commit: reference images are not committed to git (in `.gitignore`)

**1.5 Gate 7 — Disclosure watermark (legally required first)**
- [ ] Implement `src/gates/gate7-watermark.ts` fully (not a stub)
- [ ] Implement `src/media/ffmpeg.ts` → `burnWatermark()` function
- [ ] Test: run `burnWatermark()` on a sample video, verify text is visible
- [ ] Write unit test: `tests/unit/gates/gate7-watermark.test.ts`
- [ ] Run test: `npm run test:unit` — gate7 test must pass

**1.6 Core utilities (full implementation)**
- [ ] `src/utils/logger.ts` — complete (already written, verify tests pass)
- [ ] `src/utils/retry.ts` — complete (already written, verify tests pass)
- [ ] `src/utils/hash.ts` — complete (already written, verify tests pass)
- [ ] `src/monitoring/telegram.ts` — complete + test with real Telegram message

**1.7 Smoke test implementation**
- [ ] Implement `scripts/smoke-test.ts` fully
- [ ] Run `npm run smoke-test` — all checks pass

**1.8 Google Drive folders**
```bash
rclone mkdir "gdrive:cryptidvlog-references"
rclone mkdir "gdrive:cryptidvlog-archive"
rclone mkdir "gdrive:cryptidvlog-output"
```
- [ ] Upload all 6 reference images to `gdrive:cryptidvlog-references`

### Acceptance Criteria
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run test:unit` — gate7 + utils tests pass
- [ ] `npm run check-env` — all 13+ vars pass
- [ ] `npm run smoke-test` — all checks pass
- [ ] Gate 7 produces watermarked video from a fixture input
- [ ] Supabase has all tables; characters table seeded
- [ ] Character IP check run, results stored, LOW risk confirmed

### Risk Flags
- ElevenLabs voice creation takes 1–2 days if using cloned voice; use synthetic voices at launch
- YouTube OAuth refresh token has expiry; document renewal procedure
- Supabase free tier has row limits; monitor early

---

## PHASE 2 — AI Clients
**Duration:** 4–5 days | **Weeks:** 3–4

### Goals
Implement all AI API clients with full fallback chains. No pipeline logic yet — just the clients and vendor health monitoring.

### Tasks

**2.1 Claude/GPT-4o client (already partially written)**
- [ ] Complete `src/ai/claude.ts` — verify both `runVisionAnalysis` and `runTextAnalysis`
- [ ] Implement fallback routing on 529/5xx (already stubbed)
- [ ] Write unit tests: `tests/unit/ai/claude.test.ts` using msw mocks
- [ ] Test: trigger mock 529 → confirm GPT-4o is called
- [ ] Test: trigger mock 401 → confirm no fallback (re-thrown)

**2.2 fal.ai / Veo video client**
- [ ] Implement `src/ai/veo.ts` → `generateScene()`
- [ ] fal.ai Veo 3.1 endpoint: `text-to-video` for scene 1
- [ ] fal.ai Veo 3.1 endpoint: `reference-to-video` for scenes 2–5
- [ ] Replicate fallback: same model, different API format
- [ ] Slideshow fallback: call `generateSlideshow()` when both video providers fail
- [ ] Write unit tests: `tests/unit/ai/veo.test.ts`
- [ ] Integration test: real fal.ai call with short prompt (5 seconds, lowest quality) — smoke only

**2.3 Slideshow fallback pipeline**
- [ ] Implement `src/ai/image.ts` → `generateStillImage()` via Flux (fal.ai) or DALL-E
- [ ] Implement `src/ai/veo.ts` → `generateSlideshow()`:
  - Generate 5 still images
  - Ken Burns animation per image: `scale=8000:-1,zoompan=...,scale=1080:1920`
  - Concatenate into final video
- [ ] Test: generate slideshow from fixture visual DNA — output is valid MP4

**2.4 Voice synthesis client**
- [ ] Implement `src/ai/voice.ts` → `synthesizeVoice()`
- [ ] ElevenLabs primary with character voice IDs from env
- [ ] Cartesia fallback — pre-configure Cartesia voices before this phase
- [ ] OpenAI TTS tertiary (nova = Yeti, onyx = Bigfoot) — flag `requiresHumanReview: true`
- [ ] Write unit tests: `tests/unit/ai/voice.test.ts`

**2.5 Vendor health monitor**
- [ ] Implement `src/monitoring/vendor-health.ts` → `checkVendorHealth()`
- [ ] Poll all 5 status pages (fal.ai, Anthropic, ElevenLabs, Supabase, Blotato)
- [ ] Store results in `vendor_health_log`
- [ ] Alert via Telegram on state change (operational → degraded)
- [ ] Implement `startHealthMonitor()` — 30-minute polling interval
- [ ] Write unit tests: `tests/unit/monitoring/vendor-health.test.ts`

**2.6 DB client — full implementation**
- [ ] Verify `src/db/client.ts` handles all error cases
- [ ] Test SQLite fallback: mock Supabase connection failure → writes go to SQLite
- [ ] Test `syncLocalToSupabase()`: seed SQLite pending records → sync → verify cleared

### Acceptance Criteria
- [ ] All AI client unit tests pass with msw mocks
- [ ] Real fal.ai smoke test produces a 5-second video
- [ ] Real ElevenLabs call produces audio for both characters
- [ ] Vendor health monitor runs and logs to Supabase
- [ ] Telegram alert received when vendor health monitor finds a degraded service
- [ ] SQLite fallback activates and recovers on Supabase reconnect

### Risk Flags
- fal.ai Veo 3.1 may have queue times — build in polling logic, not just one-shot requests
- Replicate may not host Veo 3.1 — verify before Phase 2 or substitute Runway Gen-3
- ElevenLabs API format changes frequently — pin to a specific SDK version

---

## PHASE 3 — Pipeline Core
**Duration:** 5–6 days | **Weeks:** 5–6

### Goals
Implement the three core pipeline modules: Ideator, Scriptwriter, and Producer (single scene). By end of phase, one complete scene exists on disk.

### Tasks

**3.1 Reference image system**
- [ ] Implement `src/db/characters.ts` → `getReferenceImages()`
- [ ] Load reference images from `gdrive:cryptidvlog-references` via rclone
- [ ] Cache locally in `CHARACTER_ASSETS_PATH`
- [ ] Implement reference versioning directory structure:
  ```
  assets/characters/yeti/v1/front.png
  assets/characters/yeti/best_frames/
  ```

**3.2 Frame extraction (needed by Producer)**
- [ ] Implement `src/media/frames.ts` → `extractKeyframes()`, `extractLastFrame()`, `cleanFrame()`
- [ ] `cleanFrame()`: lanczos upscale 3840×2160 → downscale 1920×1080
- [ ] Write unit tests: `tests/unit/media/frames.test.ts`

**3.3 Ideator**
- [ ] Implement `src/pipeline/ideator.ts` → `generateConcept()`
- [ ] Generate 10 candidates using `runTextAnalysis()`
- [ ] Semantic dedup: reject if cosine similarity > 0.85 to last 50 concepts
  - Simple implementation: embed concept title with OpenAI embeddings, compare
- [ ] Scenario template dedup: detect "Yeti tries [X]" pattern repeats
- [ ] Score candidates: novelty (40%), character engagement (35%), trending alignment (25%)
- [ ] Return winner, store in `videos` table with `status: 'scripted'`
- [ ] Fall back to `concept_injection_queue` if all 10 are duplicates
- [ ] Write unit tests: `tests/unit/pipeline/ideator.test.ts`

**3.4 Scriptwriter**
- [ ] Implement `src/pipeline/scriptwriter.ts` → `writeScript()`
- [ ] Generate 4-scene script from winning concept
- [ ] Each scene: environment, dialogue, action_desc, transition_note
- [ ] Stub callback validation (full implementation in Phase 5)
- [ ] Store scenes in `scenes` table
- [ ] Write unit tests: `tests/unit/pipeline/scriptwriter.test.ts`

**3.5 Producer (single scene)**
- [ ] Implement `src/pipeline/producer.ts` → `produceScene()`
- [ ] Scene 1: `text-to-video` with character prompt + environment + lighting desc
- [ ] Scenes 2–5: `reference-to-video` — use clean last frame from previous scene
- [ ] Poll fal.ai for completion (async job pattern)
- [ ] Download completed video to `TEMP_DIR/scenes/`
- [ ] Track cost in `scene_costs`
- [ ] Alert Telegram if video cost > $20
- [ ] Retry on failure: max `MAX_SCENE_RETRIES` per scene
- [ ] Write unit tests: `tests/unit/pipeline/producer.test.ts`

**3.6 End-to-end single scene test**
- [ ] Run Ideator → Scriptwriter → Producer (scene 1 only) manually
- [ ] Confirm: concept in DB, 4 scene records created, scene 1 MP4 on disk
- [ ] Verify cost tracked in `scene_costs`

### Acceptance Criteria
- [ ] Ideator returns novel concept and stores in DB
- [ ] Scriptwriter produces 4-scene script with all required fields
- [ ] Producer generates scene 1 MP4 (real Veo call)
- [ ] Scene file exists at `TEMP_DIR/scenes/scene_0_<video_id>.mp4`
- [ ] Scene cost logged in `scene_costs`
- [ ] All unit tests pass

### Risk Flags
- Veo generation takes 1–3 minutes per scene; factor into timeout settings
- Semantic dedup requires embeddings API call (small cost); consider caching
- fal.ai job polling: implement exponential backoff, not tight polling loop

---

## PHASE 4 — Quality Gates
**Duration:** 6–7 days | **Weeks:** 7–8

### Goals
Implement all 7 quality gates and the gate runner. By end of phase, a scene can pass through the full gate pipeline.

### Tasks

**4.1 Gate 1 — Character Consistency Scorer**
- [ ] Implement `src/gates/gate1-consistency.ts` → `scoreConsistency()`
- [ ] Extract 3 keyframes via `extractKeyframes()`
- [ ] Load reference images via `getReferenceImages()`
- [ ] Build Claude vision prompt: score 5 dimensions 0–100
- [ ] Parse JSON response, compute composite, set `pass: composite >= 70`
- [ ] Auto-save frames scoring ≥ 95 to `best_frames/` directory
- [ ] Write result to `character_consistency_scores` table
- [ ] Check trend: if 10-episode avg < 80, alert Telegram
- [ ] Write unit tests: `tests/unit/gates/gate1-consistency.test.ts`

**4.2 Gate 2 — Scene Continuity**
- [ ] Implement `src/gates/gate2-continuity.ts` → `checkContinuity()`
- [ ] Skip for scene 1 (no previous scene)
- [ ] Extract last frame of previous scene, first frame of current
- [ ] Claude vision: check lighting, time-of-day, character position, color grade
- [ ] Minor issues → pass with note; major issues → fail
- [ ] Write unit tests: `tests/unit/gates/gate2-continuity.test.ts`

**4.3 Gate 3 — Face Detection**
- [ ] Implement `src/gates/gate3-face.ts` → `detectAndBlurFaces()`
- [ ] Use Python script calling MediaPipe (from WSL2) or sharp-based detection
- [ ] FFmpeg blur on detected face bounding boxes
- [ ] Always returns `pass: true` (transforms, never rejects)
- [ ] Write unit tests using face fixture images

**4.4 Gate 4 — Content Policy + DMCA Visual**
- [ ] Implement `src/gates/gate4-content.ts` → `checkContent()`
- [ ] Content policy check: age-appropriate, no violence, no substances
- [ ] DMCA visual check: logos, trademarks, copyrighted characters
- [ ] `dmca_risk: 'high'` → reject; `'medium'` → flag for review; `'none'/'low'` → pass
- [ ] Write unit tests: `tests/unit/gates/gate4-content.test.ts`

**4.5 Gate 5 — Voice Consistency**
- [ ] Implement `src/media/audio.ts` → `analyzeLoudness()`, `analyzePitch()`
- [ ] Use FFmpeg `volumedetect` filter for loudness
- [ ] Use `aubiopitch` or FFmpeg `ashowinfo` for pitch analysis
- [ ] Implement `src/gates/gate5-voice.ts` → `checkVoiceConsistency()`
- [ ] Compare detected pitch to `CHARACTER_VOICE_RANGES`
- [ ] Write unit tests

**4.6 Gate 6 — Crop Safety**
- [ ] Implement `src/gates/gate6-crop.ts` → `checkCropSafety()`
- [ ] Extract center frame at 9:16 crop
- [ ] Claude vision: is main character visible in safe zone?
- [ ] Write unit tests

**4.7 Gate runner**
- [ ] Implement `src/gates/index.ts` → `runGatePipeline()`
- [ ] Run gates 1 → 7 in strict order
- [ ] On gate failure: retry once if retry budget available
- [ ] Return `GateRunResult` with per-gate results, `outputPath` (after gate 7 watermark)
- [ ] Write integration test: `tests/integration/pipeline/gate-pipeline.test.ts`

**4.8 Full gate pipeline integration test**
- [ ] Use `tests/fixtures/videos/scene-valid.mp4` through all 7 gates
- [ ] Verify output video exists with watermark burned in
- [ ] Use `scene-no-audio.mp4` → confirm Gate 5 fails correctly

### Acceptance Criteria
- [ ] All 7 gate unit tests pass
- [ ] Gate pipeline integration test passes (valid scene passes all gates)
- [ ] Gate failure integration test passes (silent scene fails Gate 5)
- [ ] Real scene from Phase 3 passes all 7 gates end-to-end
- [ ] Consistency score is stored in `character_consistency_scores`
- [ ] Watermarked output video is produced

### Risk Flags
- Face detection accuracy varies; set conservative threshold to avoid false negatives
- Aubiopitch may not be available in all WSL2 distros — install via `apt` or `pip`
- Gate 1 with real Claude vision: ~5–8s per scene; 4 scenes = 20–32s gate overhead

---

## PHASE 5 — Assembly & Memory
**Duration:** 5–6 days | **Weeks:** 9–10

### Goals
Full multi-scene production: assemble gated scenes into a final video, validate character memory, implement A/B testing, and add human review queue.

### Tasks

**5.1 Multi-scene Producer**
- [ ] Extend `produceScene()` to loop all 4–5 scenes sequentially
- [ ] Pass clean last frame as first-frame reference for each chained scene
- [ ] Track total video cost; alert if > $20
- [ ] After all scenes: count successes, abort if 0

**5.2 Scene Assembler**
- [ ] Implement `src/pipeline/assembler.ts` → `assembleVideo()`
- [ ] `concatenateScenes()`: FFmpeg concat filter
- [ ] `stripAudio()`: remove all Veo audio (DMCA protection)
- [ ] `synthesizeVoice()`: generate dialogue for each scene character
- [ ] `mixAudio()`: dialogue at -3dB, licensed music at -18dB
- [ ] `applyColorGrade()`: cinematic LUT or `eq=contrast=1.1:saturation=1.2` filter
- [ ] `applyFilmGrain()`: `noise=alls=10:allf=t` or overlay grain texture
- [ ] Output: `TEMP_DIR/assembled/<video_id>.mp4`
- [ ] Update video `status: 'assembled'`
- [ ] Write integration test: `tests/integration/pipeline/media-pipeline.test.ts`

**5.3 Character Memory Integrity**
- [ ] Implement `src/db/memory.ts` → `validateCallback()`
- [ ] Load last 50 `character_interactions` for character
- [ ] Claude text analysis: does callback match real history?
- [ ] If invalid: Scriptwriter generates replacement dialogue (not rejection)
- [ ] Write unit tests: `tests/unit/db/memory.test.ts`

**5.4 A/B Hook Testing**
- [ ] Implement A/B priority selector in `src/pipeline/producer.ts`
- [ ] Priority scoring: new archetype (+30), trending hook (+25), series opener (+20), ideator score (×0.25)
- [ ] Check A/B budget before generating variant
- [ ] Store variant as separate `videos` row with `parent_video_id`
- [ ] Write unit tests: `tests/integration/pipeline/ab-testing.test.ts`

**5.5 Retry Manager**
- [ ] Implement retry budget checking in `src/monitoring/costs.ts`
- [ ] `getDailyRetrySpend()` — sum retry_cost from today's scene_costs
- [ ] Check before each scene retry: abort if `getDailyRetrySpend() >= RETRY_RESERVE`
- [ ] Alert Telegram when retry reserve exhausted

**5.6 Human review queue**
- [ ] Implement Telegram review request in `telegram.ts`
- [ ] On assembled video: send review message with video ID
- [ ] Update video `status: 'pending_review'`
- [ ] Implement `src/pipeline/publisher.ts` → `approveVideo()` and `rejectVideo()`

### Acceptance Criteria
- [ ] Full 4-scene video assembled from real Veo generations
- [ ] Audio: dialogue audible, music present, no Veo audio artifacts
- [ ] Assembler output is valid MP4 at 1080×1920
- [ ] Memory integrity validator correctly rejects invented callback
- [ ] A/B test generates second variant when budget permits
- [ ] Human review message received in Telegram
- [ ] Video in `pending_review` status after pipeline completes

### Risk Flags
- Audio sync can drift with long scene chains — test with 5-scene videos specifically
- A/B testing doubles generation cost for selected videos; monitor closely
- Film grain filter adds ~15–20% to file size; confirm storage cleanup runs daily

---

## PHASE 6 — Publishing & Operations
**Duration:** 5–6 days | **Weeks:** 11–12

### Goals
Connect publishing to all three platforms, implement full cost tracking, buffer management, and storage cleanup automation.

### Tasks

**6.1 Platform uploaders**
- [ ] Implement `src/platforms/youtube.ts`:
  - OAuth 2.0 with refresh token
  - `containsSyntheticMedia: true` in status object
  - `selfDeclaredMadeForKids: false`
  - Description includes "AI-generated content" disclosure
- [ ] Implement `src/platforms/tiktok.ts`:
  - `aigc_description: 'ai_generated'` (mandatory AIGC label)
- [ ] Implement `src/platforms/instagram.ts`:
  - Reels endpoint (9:16 ratio confirmed)
  - "AI-generated content" in caption
- [ ] Implement `src/platforms/blotato.ts` as primary publishing layer
  - Route YouTube + TikTok + Instagram through Blotato API
  - Direct platform calls as fallback if Blotato fails
- [ ] Write unit tests with mock platform APIs

**6.2 Publisher integration**
- [ ] Complete `src/pipeline/publisher.ts` → `publishVideo()`
- [ ] Schedule in next available slot (respect `VIDEOS_PER_DAY` cadence)
- [ ] On success: update video with platform URLs, set `status: 'published'`
- [ ] On failure: do not mark as published, alert Telegram

**6.3 Cost tracking**
- [ ] Implement `src/monitoring/costs.ts` → `getDailySpend()`, `trackSceneCost()`, `isDailyCapReached()`
- [ ] `trackSceneCost()`: insert to `scene_costs`, update `daily_budget_log`
- [ ] Alert Telegram when daily spend crosses $60 warning threshold
- [ ] Hard cap enforcement: abort run if `isDailyCapReached()`
- [ ] A/B budget enforcer: skip A/B if `ab_spend >= AB_BUDGET_DAILY`
- [ ] Write unit + cost regression tests

**6.4 Buffer manager**
- [ ] Implement `src/monitoring/buffer.ts` → `assessBuffer()`
- [ ] Normal minimum: 2 days; vendor outage mode: 5 days
- [ ] Action: `normal` / `generate_extra` / `reduce_cadence`
- [ ] Reduce cadence: publish 1/day instead of 2/day until buffer recovers

**6.5 Storage cleanup**
- [ ] Implement daily cleanup cron (run at midnight WSL2):
  ```bash
  find TEMP_DIR/scenes -name "*.mp4" -mtime +3 -delete
  find TEMP_DIR/ab_variants -name "*.mp4" -mtime +1 -delete
  find TEMP_DIR/assembled -name "*.mp4" -mtime +90 -exec mv {} ~/cryptidvlog/archive/ \;
  ```
- [ ] Track deletion in `storage_files` table

**6.6 First real publish**
- [ ] Full run: Ideator → Script → Produce → Gates → Assemble → Review → Approve → Publish
- [ ] Confirm video live on YouTube with AI disclosure label visible
- [ ] Confirm video live on TikTok with AIGC label
- [ ] Confirm video live on Instagram Reels

### Acceptance Criteria
- [ ] Video published to all 3 platforms via Blotato
- [ ] YouTube video has "Altered/synthetic content" label visible
- [ ] TikTok video has AIGC label visible
- [ ] Daily cost tracked correctly (spot-check against actual API invoices)
- [ ] Buffer manager correctly recommends `generate_extra` when buffer < 2 days
- [ ] Storage cleanup script deletes raw scenes older than 3 days

### Risk Flags
- YouTube, TikTok, Instagram API approvals can take days — start applications immediately at Pre-Phase
- Blotato API availability: test posting manually before automating
- Instagram Reels requires video length constraints (15s–90s) — confirm assembled length

---

## PHASE 7 — Hardening & Monitoring
**Duration:** 4–5 days | **Weeks:** 13–14

### Goals
Full compliance implementation, emergency procedures, Windows Task Scheduler cron setup, and 7-day autonomous operation validation.

### Tasks

**7.1 Emergency takedown**
- [ ] Complete `scripts/emergency-takedown.ts` — real platform API calls
- [ ] YouTube: set `privacyStatus: 'private'`
- [ ] TikTok: privacy status API call
- [ ] Instagram: set to hidden/private
- [ ] Test: takedown a test video manually, verify private on all platforms

**7.2 GDPR deletion workflow**
- [ ] Complete `src/compliance/gdpr.ts` (new file) → `processGDPRDeletion()`
- [ ] Remove from email provider API
- [ ] Delete from `newsletter_signups`
- [ ] Insert hashed record to `gdpr_deletion_log`
- [ ] Test with a real email address

**7.3 Windows Task Scheduler cron**
- [ ] Implement `/cryptidvlog cron-setup` command in SKILL.md (already documented)
- [ ] Write `~/cryptidvlog-cron.sh` script to SKILL output
- [ ] Write `cryptidvlog-scheduler.bat` Windows wrapper
- [ ] Manual setup: open Task Scheduler, create daily 8:00 AM task pointing to `.bat`
- [ ] Fill in API keys in `cryptidvlog-cron.sh` (never committed to git)
- [ ] Test: run `.bat` manually from Windows, verify WSL2 cron script executes

**7.4 Analytics feedback loop**
- [ ] Query YouTube/TikTok analytics for published videos after 48 hours
- [ ] Store view count, CTR in `ab_test_results` for A/B videos
- [ ] Determine A/B winner by CTR at 48 hours
- [ ] Feed winning hook style back into Ideator scoring

**7.5 Consistency trend monitoring**
- [ ] Implement trend check in `src/db/characters.ts` → `getConsistencyTrend()`
- [ ] After each video: if 10-episode average drops below 80, alert Telegram
- [ ] Alert message: "Yeti consistency dropping (avg: XX). Consider reference refresh."

**7.6 7-day autonomous validation**
- [ ] Enable cron; do not manually intervene for 7 days
- [ ] Review Telegram alerts daily (review queue + any errors)
- [ ] Approve/reject via Telegram replies
- [ ] After 7 days: review cost report, consistency trends, platform performance
- [ ] Document any recurring issues in KNOWN_ISSUES.md

**7.7 Legal privacy notice publication**
- [ ] Publish Privacy Notice to YouTube channel About section
- [ ] Add to Discord server info (if Discord built)
- [ ] Add to newsletter footer (if newsletter built)
- [ ] Document COPPA decision on file (internal record)

### Acceptance Criteria
- [ ] Emergency takedown tested successfully on all 3 platforms
- [ ] Cron runs autonomously for 7 days without manual intervention
- [ ] 14+ videos published across 7 days (2/day cadence)
- [ ] All Telegram alerts actionable (no false positives)
- [ ] A/B winner determined for at least 2 A/B tests
- [ ] Privacy notice published publicly
- [ ] KNOWN_ISSUES.md documents any patterns observed

### Risk Flags
- Task Scheduler + WSL2 interaction has edge cases (WSL2 not started, path issues) — test thoroughly
- 7-day autonomous run will surface unexpected edge cases; plan for daily 5-minute check

---

## First Run Guide

After Phase 5 is complete, use this guide for the very first real pipeline run:

```bash
# 1. Verify environment
npm run smoke-test

# 2. Check vendor health
npx tsx src/monitoring/vendor-health.ts --check

# 3. Upload a test reference image
rclone copy ~/cryptidvlog/assets/characters/yeti/v1/front.png "gdrive:cryptidvlog-references/"

# 4. Run the pipeline (first time — watch output carefully)
# In Claude Code:
/cryptidvlog run

# 5. Watch for:
#    - Ideator output: concept printed to stdout
#    - Scriptwriter output: 4 scenes printed
#    - Producer: "Generating scene 1/4..." + fal.ai job ID
#    - Gates: per-gate pass/fail for each scene
#    - Assembler: output file path
#    - Telegram: review request received

# 6. Review in Telegram, then:
/cryptidvlog approve <video-id>

# 7. Confirm published on all 3 platforms
```

---

## Budget Projection

| Scenario | Daily Cost | Monthly Cost |
|----------|-----------|-------------|
| 2 videos/day, no A/B, no retries | ~$32 | ~$960 |
| 2 videos/day, A/B on 1 video, 1 retry avg | ~$44 | ~$1,320 |
| 2 videos/day, A/B on both, 2 retries avg | ~$56 | ~$1,680 |
| Hard cap (worst case) | $75 | $2,250 |

All scenarios within the $75/day hard cap. Target is $45/day at steady state.
