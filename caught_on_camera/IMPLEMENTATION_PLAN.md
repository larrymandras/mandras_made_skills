# CAUGHT ON CAMERA — IMPLEMENTATION PLAN

## v1.0 | February 2026 | Node.js + TypeScript + WSL2

---

## Pre-Phase Checklist (Before Any Code)

Complete all items below before Phase 1 begins. None are optional.

```
ACCOUNTS & KEYS
□ Anthropic API key (Claude claude-sonnet-4-6 access confirmed)
□ fal.ai API key + Veo 3.1 access confirmed
□ Supabase project created (free tier OK for launch)
□ Cloudinary account created (free tier OK for launch)
□ Blotato account + API key obtained
□ YouTube channel created, Data API OAuth 2.0 credentials obtained
□ TikTok Developer API access approved + account added to Blotato
□ Instagram professional account + Graph API access approved + added to Blotato
□ Telegram bot created via @BotFather, chat ID noted

LEGAL
□ Platform terms reviewed: YouTube synthetic media policy, TikTok AIGC policy, Instagram AI labeling requirements
□ Decision documented: "Not Made for Kids" rationale on file (COPPA)
□ Privacy notice drafted and ready to publish in channel descriptions
□ Legal review of police_security sub-type content scope: confirm "clearly fictional AI-generated" framing is compliant with local impersonation laws before enabling
□ Gate 7 (disclosure watermark) MUST be operational before ANY video is generated — this is the legally mandatory control

OVERLAY ASSETS
□ Ring cam overlay PNG templates created (see Phase 1 asset guide in SKILL.md)
□ Body cam overlay PNG templates created for each sub-type:
  - police_security: HUD frame, badge obscured, body-cam timestamp
  - hiker_trail: trail-cam frame, GPS coordinates overlay
  - dashcam: dashcam frame, speedometer, rear-view mirror
  - helmet_action: GoPro-style frame, action sport overlay
□ Validation overlay (gate 6 test pattern) created

AUDIO BEDS
□ Minimum 8 royalty-free or original WAV files sourced:
  - ring_cam: 4 tracks (ambient night, suburban day, rainy evening, tense low drone)
  - body_cam: 4 tracks (police radio crackle bed, forest ambience, traffic/road, action percussion)
□ All audio beds placed in assets/audio_beds/ring_cam/ and assets/audio_beds/body_cam/

INFRASTRUCTURE
□ WSL2 installed and configured on Windows 11 machine
□ Node.js v20 LTS installed in WSL2
□ FFmpeg installed in WSL2 (sudo apt install ffmpeg)
□ jq installed in WSL2 (sudo apt install jq)
□ GitHub repo mandras_made_skills exists with caught_on_camera/ directory
```

---

## Dependency Graph

```
Phase 1 (Foundation)
    │
    ├── Phase 2 (Ring Cam Ideator)
    │       │
    │       ├── Phase 3 (Body Cam Ideator)
    │       │       │
    │       │       └── Phase 4 (Producer + Quality Gates)
    │       │               │
    │       │               └── Phase 5 (Review + Distribution)
    │       │                       │
    │       │                       └── Phase 6 (Polish + Launch)
    │       │
    │       └── Phase 2 also gates Phase 4 (Ideator DB schema required)
    │
    └── Phase 1 gates everything (Gate 7 must be proven before Phase 2)
```

All phases are strictly sequential. No phase begins until the previous phase's acceptance criteria are fully met.

---

## PHASE 1 — Foundation
**Duration:** 5–7 days | **Weeks:** 1–2

### Goals
Establish the dual-format project skeleton, database schema, environment validation, overlay pipeline, audio bed library, and Gate 7 (disclosure watermark) — the legally mandatory gate — before any video generation begins.

Gate 7 must be proven working on a test video before Phase 2 starts. No exceptions.

### Tasks

**1.1 Project initialization**
- [ ] Clone `mandras_made_skills` repo locally into WSL2
- [ ] Navigate to `caught_on_camera/` directory
- [ ] Run `npm install` — verify all dependencies resolve
- [ ] Run `npm run typecheck` — verify zero TypeScript errors in stubs
- [ ] Confirm `vitest` runs and finds test files (0 tests passing is fine at this stage)

**1.2 Environment setup**
- [ ] Copy `.env.example` → `.env`, fill in all required API keys (see SKILL.md Setup section)
- [ ] Run `npm run check-env` — all required vars must pass
- [ ] Verify FFmpeg: `ffmpeg -version` in WSL2
- [ ] Verify Node.js version: `node --version` (must be ≥ 20)

**1.3 Database migrations — 5 migrations in order**
- [ ] Run `npm run setup-db` to apply all 5 migrations
- [ ] Verify in Supabase dashboard that these tables exist:
  - `videos`, `ring_cam_ideas`, `body_cam_ideas` (migration 001)
  - `scenes`, `costs`, `scene_costs`, `daily_budget_log` (migration 003)
  - `compliance`, `content_pauses`, `takedown_log` (migration 004)
  - `platform_health`, `platform_publishes`, `analytics` (migration 005)
- [ ] Verify `config` table seeded with FORMAT_SCHEDULE and budget defaults

**1.4 Gate 7 — Disclosure watermark (legally required first)**
- [ ] Implement `src/gates/gate7-disclosure.ts` fully — burn "AI GENERATED" watermark + disclosure text
- [ ] Implement `burnWatermark()` and `burnDisclosureText()` in `src/media/ffmpeg.ts`
- [ ] Test: run gate 7 on a fixture video, verify watermark visible in output
- [ ] Write unit test: `tests/unit/gates/gate7-disclosure.test.ts`
- [ ] Run test: `npm run test:unit` — gate7 test must pass
- [ ] Manual inspection: open output video, confirm watermark bottom-right, disclosure text visible

**1.5 Overlay asset creation and validation**
- [ ] Create ring cam overlay PNG templates:
  - `assets/overlays/ring_cam/standard.png` — standard doorbell cam frame
  - `assets/overlays/ring_cam/night.png` — night-vision tinted frame
  - `assets/overlays/ring_cam/motion_alert.png` — motion-detected indicator variant
- [ ] Create body cam overlay PNG templates per sub-type:
  - `assets/overlays/body_cam/police_security/` — badge obscured, HUD elements
  - `assets/overlays/body_cam/hiker_trail/` — trail cam aesthetic, GPS coords
  - `assets/overlays/body_cam/dashcam/` — dashcam frame, speed display
  - `assets/overlays/body_cam/helmet_action/` — action cam frame, sport aesthetic
- [ ] Validate FFmpeg overlay compositing for both formats:
  ```bash
  ffmpeg -i test_clip.mp4 -i assets/overlays/ring_cam/standard.png \
    -filter_complex "overlay=0:0" -c:a copy test_ring_overlay.mp4
  ffmpeg -i test_clip.mp4 -i assets/overlays/body_cam/dashcam/frame.png \
    -filter_complex "overlay=0:0" -c:a copy test_body_overlay.mp4
  ```
- [ ] Inspect output: overlay renders correctly without color banding or alpha issues

**1.6 Audio bed library**
- [ ] Source 8 minimum audio beds (see pre-phase checklist)
- [ ] Place in `assets/audio_beds/ring_cam/` and `assets/audio_beds/body_cam/`
- [ ] Verify FFmpeg can mix each audio bed with a test video:
  ```bash
  ffmpeg -i test_clip.mp4 -i assets/audio_beds/ring_cam/ambient_night.wav \
    -filter_complex "[1:a]volume=-18dB[bed];[0:a][bed]amix=inputs=2" test_mix.mp4
  ```

**1.7 Core utilities — full implementation**
- [ ] `src/utils/logger.ts` — complete (already written, verify tests pass)
- [ ] `src/utils/retry.ts` — complete (already written, verify tests pass)
- [ ] `src/utils/hash.ts` — complete (already written, verify tests pass)
- [ ] `src/monitoring/telegram.ts` — complete + test with real Telegram message

**1.8 Smoke test**
- [ ] Run `npm run smoke-test` — all 10 checks must pass
- [ ] If any fail, fix before proceeding

**1.9 Pre-launch legal checklist**
- [ ] Confirm ENABLE_POLICE_SUBTYPE default and legal review of scope (see Pre-Phase above)
- [ ] Confirm all overlay PNG templates do NOT contain real law enforcement insignia
- [ ] Confirm all body cam sub-types are clearly framed as AI-generated fictional content
- [ ] Document decision in a comment in `src/config.ts` near the ENABLE_POLICE_SUBTYPE flag

### Acceptance Criteria
- [ ] `npm run typecheck` — 0 TypeScript errors
- [ ] `npm run test:unit` — gate7 + utils tests pass
- [ ] `npm run check-env` — all required vars pass
- [ ] `npm run smoke-test` — all 10 tests pass
- [ ] Gate 7 produces a watermarked output video from a fixture file (manual inspection)
- [ ] Overlay compositing works for ring_cam and at least one body_cam sub-type (manual FFmpeg test)
- [ ] Supabase has all 5 migrations applied; config table seeded
- [ ] Audio bed directory has at least 4 WAV files (2 per format)

### Risk Flags
- Supabase exec_sql RPC may not be available on all project tiers — use `npx supabase db push` if setup-db fails
- Overlay PNG alpha channel issues can corrupt composited video — test on actual fixture clips, not synthetic images
- WSL2 and Windows path interop: always use forward-slash paths within WSL2

---

## PHASE 2 — Ring Cam Ideator
**Duration:** 5–7 days | **Weeks:** 3–4

### Goals
Build the Ring Cam Ideator: generates viral ring camera concepts with 7-category rotation, virality scoring, and dedup engine. By end of phase, 50+ ring cam concepts are stored and validated.

### Tasks

**2.1 Ring Cam Ideator — concept generation**
- [ ] Implement `src/pipeline/ring-cam-ideator.ts` → `generateRingCamIdea()`
- [ ] Prompt template: static security camera POV, doorbell/porch/driveway setting
- [ ] 7-category rotation: `animals | paranormal | delivery | weather | wholesome | fails | night_shift`
- [ ] Category weight tracking: underused categories get higher weight in selection
- [ ] Generate 10 ring cam concept candidates per run using `runTextAnalysis()` (Claude)
- [ ] Each candidate: title, hook, category, sub_format (ring_cam), virality_score (0–100), estimated_cost

**2.2 Virality scoring formula — ring cam**
- [ ] Implement `scoreRingCamVirality(concept)`:
  - Relatable setting score (0–25): doorbell/porch/driveway recognition
  - Surprise / unexpected element (0–25): how unexpected is the subject
  - Loop potential (0–25): does it invite re-watching?
  - Shareable emotion (0–25): amusement, disbelief, warmth
- [ ] Reject candidates scoring below 60/100
- [ ] Store virality breakdown per idea in `ring_cam_ideas` table

**2.3 Dedup engine — ring cam**
- [ ] Implement `src/db/dedup.ts` → `isRingCamDuplicate(candidate)`
- [ ] Semantic similarity check: embed candidate title using Claude's text embedding equivalent (or SHA-256 title hash for MVP)
- [ ] Compare against last 100 ring_cam_ideas in DB
- [ ] Reject if cosine similarity > 0.85 to any recent idea
- [ ] Category-level dedup: same category cannot run more than 3 days in a row
- [ ] Write unit tests: `tests/unit/pipeline/dedup.test.ts`

**2.4 Gate 4 Stage A — prompt sanitizer (ring cam)**
- [ ] `sanitizePrompt()` already implemented in `src/gates/gate4-policy.ts`
- [ ] Verify all ring cam concepts pass sanitizer before being stored to DB
- [ ] Add ring-cam-specific blocked terms: police, badge, siren (already in ALWAYS_BLOCKED)
- [ ] Write unit tests: `tests/unit/gates/gate4-policy.test.ts`

**2.5 Bulk ideator run**
- [ ] Run `generateRingCamIdea()` 15× (or until 50+ valid ideas in DB)
- [ ] Inspect results in Supabase: virality scores, categories, no duplicates
- [ ] Manually review 10 random concepts for quality — flag any that feel generic

**2.6 Ideas queue integration**
- [ ] Implement `src/db/ideas.ts` → `getNextRingCamIdea()` — pulls highest virality_score pending idea
- [ ] Status flow: `pending` → `in_production` → `done` / `rejected`
- [ ] Mark idea `in_production` when pipeline picks it up (prevents double-use)

### Acceptance Criteria
- [ ] 50+ ring_cam_ideas rows in DB, all status `pending`
- [ ] No two ideas with cosine similarity > 0.85
- [ ] No single category appears more than 3× consecutively
- [ ] All ideas pass `sanitizePrompt()` — zero blocked words
- [ ] `gate4-policy.test.ts` unit tests pass
- [ ] `dedup.test.ts` unit tests pass

### Risk Flags
- Claude text generation costs add up across 15+ runs — batch 10 candidates per Claude call
- Simple SHA-256 dedup may miss semantic near-duplicates; upgrade to embedding-based dedup in Phase 3 if budget allows

---

## PHASE 3 — Body Cam Ideator
**Duration:** 5–7 days | **Weeks:** 4–5

### Goals
Build the Body Cam Ideator with 4 sub-type selection logic, body-cam virality formula, ethics kill switch for police_security sub-type, and cross-format dedup.

### Tasks

**3.1 Body Cam Ideator — concept generation**
- [ ] Implement `src/pipeline/body-cam-ideator.ts` → `generateBodyCamIdea()`
- [ ] Prompt template: first-person POV walking/driving camera
- [ ] Sub-type selection: `police_security | hiker_trail | dashcam | helmet_action`
- [ ] Sub-type weighting: equal weight by default; `police_security` excluded when `ENABLE_POLICE_SUBTYPE=false`
- [ ] 7-category rotation: `encounter | pursuit | discovery | weather_nature | night_ops | response | dashcam_chaos`
- [ ] Generate 10 body cam concept candidates per run

**3.2 Sub-type selection logic**
- [ ] Implement `selectBodyCamSubType(enablePolice: boolean)`:
  - If police disabled: only `hiker_trail`, `dashcam`, `helmet_action` eligible
  - Rotate sub-types so no sub-type repeats more than 2× per week
- [ ] Implement sub-type prompt anchors (seed phrases per sub-type — see SKILL.md Reference Tables)
- [ ] Write unit tests: `tests/unit/pipeline/body-cam-ideator.test.ts`

**3.3 Body cam virality formula**
- [ ] Implement `scoreBodyCamVirality(concept)`:
  - POV immersion score (0–30): how convincing is the first-person perspective
  - Tension / drama arc (0–25): does the clip build and resolve
  - "Wait, is this real?" factor (0–25): ambiguity of AI vs real
  - Shareable reaction (0–20): anger, awe, humor
- [ ] Reject candidates scoring below 65/100 (higher bar than ring cam due to content sensitivity)

**3.4 Ethics kill switch — police_security sub-type**
- [ ] Confirm `ENABLE_POLICE_SUBTYPE` env flag is respected in `generateBodyCamIdea()`
- [ ] Add additional blocked words for police_security concepts beyond ALWAYS_BLOCKED:
  - `lawsuit`, `brutality`, `civil rights`, `excessive force`, `protest`, `riot`
- [ ] Add post-generation content check for police_security sub-type ideas:
  Claude reviews the concept summary for any content that could be mistaken for real law enforcement misconduct
- [ ] Write integration test: `ENABLE_POLICE_SUBTYPE=false` → only 3 non-police sub-types generated

**3.5 Cross-format dedup**
- [ ] Extend `src/db/dedup.ts` to check cross-format similarity:
  - A ring cam "UFO landing on driveway" and a body cam "hiker films UFO landing" → near-duplicate, reject the second
- [ ] Implement `isCrossFormatDuplicate(candidate, format)` — checks against last 50 ideas from the OTHER format too
- [ ] Write unit tests

**3.6 Bulk ideator run**
- [ ] Run `generateBodyCamIdea()` 15× (or until 50+ valid ideas in DB)
- [ ] Verify sub-type distribution is roughly even
- [ ] Manually review 10 random concepts — flag any that feel like real police/crime footage

### Acceptance Criteria
- [ ] 50+ body_cam_ideas rows in DB, all status `pending`
- [ ] Police_security sub-type disabled scenario generates only 3 sub-types
- [ ] Cross-format dedup catches a planted near-duplicate
- [ ] All police_security ideas pass the ethics content check
- [ ] Virality scores are all ≥ 65 (body cam threshold)

### Risk Flags
- Police_security sub-type is the highest-risk content type — when in doubt, leave disabled until legal review complete
- "Wait, is this real?" scoring criterion is intentionally ambiguous — this creates engagement but also responsibility; Gate 7 disclosure watermark is the control

---

## PHASE 4 — Producer Agent + Quality Gates
**Duration:** 10–14 days | **Weeks:** 5–7

### Goals
Format-switching Producer with Veo 3.1 prompt templates, all 7 quality gates fully operational, AI degradation pipeline, overlay compositing for both formats, multi-format video output, and Cloudinary upload.

### Tasks

**4.1 Format-switching Producer**
- [ ] Implement `src/pipeline/producer.ts` → `produceVideo(idea)`:
  - Detects `idea.format`: routes to ring cam or body cam prompt template
  - For body cam: also reads `idea.sub_type` to select sub-type template
- [ ] Ring cam Veo 3.1 prompt template:
  - Static camera POV, fixed perspective, outdoor residential setting
  - Distortion artifacts, timestamp overlay in corner, motion blur on subject
- [ ] Body cam Veo 3.1 prompt templates (one per sub-type):
  - `police_security`: handheld walking POV, officer vest visible, radio sounds
  - `hiker_trail`: hiking POV with footstep motion, trail camera stabilizer feel
  - `dashcam`: driver's eye level, road visible, windshield framing
  - `helmet_action`: dynamic wide-angle, GoPro fisheye effect, action sport context
- [ ] fal.ai Veo 3.1 API integration for video generation
- [ ] Poll for completion with exponential backoff (fal.ai async job pattern)
- [ ] Download completed clip to `TEMP_DIR/raw/`
- [ ] Track cost in `scene_costs` table

**4.2 AI degradation pipeline**
- [ ] Implement `src/media/degradation.ts` → `applyDegradation(videoPath, format, subType)`:
  - Ring cam: noise grain, desaturation 15%, occasional digital artifact flash, compression block
  - Body cam (police_security): motion blur on fast pan, hand-shake simulation (vidstabdetect/vidstabtransform)
  - Body cam (hiker_trail): moderate shake, organic motion, lens flare
  - Body cam (dashcam): mild vibration, occasional windshield glare
  - Body cam (helmet_action): aggressive shake, fish-eye distortion, speed artifact
- [ ] Both 16:9 master and 9:16 vertical output variants
- [ ] Write integration tests with fixture clips

**4.3 All 7 quality gates — full implementation**
- [ ] **Gate 1 — Motion gate** (`src/gates/gate1-motion.ts` — already stub):
  - Ring cam: `avgMotion <= 0.5` → PASS; `avgMotion > 0.5` → FAIL/regenerate
  - Body cam: `avgMotion >= 1.5` → PASS; `avgMotion < 1.5` → FAIL/add_shake
  - Use FFmpeg `mpdecimate` or scene change detection for motion score
- [ ] **Gate 2 — Face detection + blur** (`src/gates/gate2-face.ts` — already stub):
  - Detect faces in all keyframes via Claude vision or MediaPipe
  - Auto-apply FFmpeg blur to any face bounding boxes
  - Always returns pass (transform gate, not reject gate)
- [ ] **Gate 3 — Audio gate** (`src/gates/gate3-audio.ts` — already stub):
  - Run `ffmpeg -af volumedetect` to get `meanVolume` and `maxVolume`
  - Ring cam: `meanVolume < -40dB` → FAIL/regenerate; `meanVolume > -10dB` → FAIL/replace_audio
  - Body cam: `meanVolume < -35dB` → FAIL/mix_bed; acceptable range -35dB to -10dB → PASS
- [ ] **Gate 4 — Content policy** (already complete): run sanitizePrompt + post-gen reviewContent
- [ ] **Gate 5 — Crop safety** (`src/gates/gate5-crop.ts` — already stub):
  - Extract 9:16 center crop of each frame
  - Claude vision: is main subject + key action visible in safe zone?
  - If main subject cut off → cropSafe=false → limit to YouTube-only
- [ ] **Gate 6 — Overlay verification** (`src/gates/gate6-overlay.ts` — already stub):
  - Verify format overlay (ring_cam or body_cam sub-type) is present and readable
  - Claude vision: sample keyframe → confirm overlay frame is present, not corrupted
  - Missing overlay → FAIL/hard fail — overlay is mandatory for format identity
- [ ] **Gate 7 — Disclosure watermark** (implement in `src/gates/gate7-disclosure.ts`):
  - Burn "AI GENERATED" text to bottom-right of video using FFmpeg `drawtext`
  - Burn disclosure subtitle "This video is AI-generated" to lower-third
  - Verify watermark present via frame sample: FAIL (hard) if missing
  - This gate runs LAST and is a hard fail — mandatory legal control

**4.4 Gate runner**
- [ ] Implement `src/gates/index.ts` → `runGatePipeline(videoPath, idea)`:
  - Run gates 1 → 7 in order
  - Gate 1: on FAIL for ring_cam → regenerate clip (max 2 retries); on FAIL for body_cam → apply_shake then re-run
  - Gate 2: apply blur transform, continue
  - Gate 3: on FAIL → apply audio fix action (mix bed or replace audio), re-run gate 3
  - Gate 4: on hard fail → abort immediately, do not run subsequent gates
  - Gate 5: on fail → mark cropSafe=false, continue (soft)
  - Gate 6: on fail → abort, re-apply overlay, re-run gate 6
  - Gate 7: on fail → hard abort, alert Telegram
  - Return `GatePipelineResult` with all per-gate results and final output path

**4.5 Overlay compositing**
- [ ] Implement `src/media/overlay.ts` → `applyOverlay(videoPath, format, subType)`:
  - Load correct PNG from `assets/overlays/` based on format + sub_type
  - FFmpeg overlay composite: `overlay=0:0` with alpha channel
  - Output: new file with `_overlaid` suffix
- [ ] Write integration tests with fixture clips + fixture PNGs

**4.6 Multi-format output**
- [ ] Implement `src/media/format-outputs.ts` → `generateFormatOutputs(videoPath)`:
  - 16:9 master: `1920x1080`, H.264, AAC, 8Mbps
  - 9:16 vertical: `1080x1920`, H.264, AAC, 6Mbps (crop center or re-crop based on gate 5 result)
- [ ] Implement `src/media/cloudinary.ts` → `uploadToCloudinary(localPath, videoId, format)`:
  - Upload both outputs to Cloudinary under `caught_on_camera/<video_id>/`
  - Return Cloudinary public URLs
  - Tag with format, sub_type, gate results

### Acceptance Criteria
- [ ] Producer generates a real Veo clip from a ring cam idea
- [ ] Producer generates a real Veo clip from a body cam idea (at least one sub-type)
- [ ] All 7 gates run end-to-end on a fixture clip without errors
- [ ] Gate 1 fail ring_cam triggers regeneration; gate 1 fail body_cam triggers shake application
- [ ] Gate 3 fail triggers audio bed mixing
- [ ] Gate 4 hard fail aborts remaining gates immediately
- [ ] Gate 7 watermark visible in output video (manual inspection)
- [ ] Both 16:9 and 9:16 outputs uploaded to Cloudinary with correct tags
- [ ] Integration tests pass: `tests/integration/gate-pipeline.test.ts`, `tests/integration/media-pipeline.test.ts`

### Risk Flags
- Veo 3.1 generation time: 1–3 minutes per clip — build generous polling timeouts (10 min max)
- Degradation pipeline and overlay compositing together can take 2–5 min of FFmpeg — factor into pipeline runtime
- Gate 1 motion detection via FFmpeg is approximate — calibrate thresholds against real fixture clips

---

## PHASE 5 — Review + Distribution
**Duration:** 8–12 days | **Weeks:** 8–9

### Goals
Telegram review bot with format tags, Blotato API integration, per-platform compliance metadata, posting guardrails, suppression detection, and format schedule enforcement.

### Tasks

**5.1 Telegram review bot**
- [ ] Implement `src/monitoring/telegram.ts` → `sendReviewRequest(video)`:
  - Message format includes `[RING CAM]` or `[BODY CAM: <sub_type>]` tag
  - Includes: concept title, virality score, cost, gate results summary, Cloudinary preview URL
  - Approve command: `/approve <video_id>`
  - Reject command: `/reject <video_id> <reason>`
- [ ] Implement bot webhook or polling for `/approve` and `/reject` commands
- [ ] On approve: update `videos.status = 'approved'` → trigger publish
- [ ] On reject: update `videos.status = 'rejected'`, log reason

**5.2 Blotato API integration**
- [ ] Implement `src/platforms/blotato.ts` → `publishVideo(video, metadata)`:
  - POST to Blotato `/api/v1/posts` with video URL and platform account IDs
  - Include per-platform compliance metadata (see below)
  - Poll for publish confirmation
  - Return platform video IDs on success

**5.3 Per-platform compliance metadata**
- [ ] Implement `generateCompliantMetadata(video, platform)`:
  - All platforms: `is_ai_generated: true`, disclosure text in description/caption
  - YouTube: `self_declared_made_for_kids: false`, "AI Generated Content" in description
  - TikTok: `aigc_description: 'ai_generated'`, disclosure in caption
  - Instagram: disclosure in caption, `is_ai_generated` label if API supports it
  - Always include pinned comment on publish: "#AIGenerated — This video is AI-generated. Created with fal.ai Veo 3.1"
- [ ] Verify `isAiGenerated=true` in all `platform_publishes` DB rows

**5.4 Platform rate limiting + posting guardrails**
- [ ] Implement `canPublishToday(platform)` using `PLATFORM_LIMITS` from `src/config.ts`:
  - YouTube: max 2/day, min 4h between posts
  - TikTok: max 3/day, min 2h between posts
  - Instagram: max 2/day, min 4h between posts
  - Shorts: max 2/day, min 4h between posts
- [ ] Check limits before each publish attempt; defer if limit reached

**5.5 Suppression detection**
- [ ] Implement `src/monitoring/suppression.ts` → `checkSuppressionSignals(platform)`:
  - Query analytics for last 7 days: if average views dropped > 60% vs prior 7 days → flag suppression
  - If suppression detected: halve posting frequency on that platform (reduce `maxPerDay` by 50%)
  - Alert Telegram: "Possible suppression on TikTok — reducing posting frequency"
  - Update `platform_health` table with `suppression_detected: true`

**5.6 Format schedule enforcement**
- [ ] Implement `getFormatForToday()` using `FORMAT_SCHEDULE` from `src/config.ts`
- [ ] Pipeline pre-flight: check today's scheduled format → only pick ideas matching that format
- [ ] If `operator_choice`: pick highest-virality idea from either format
- [ ] Write unit tests: `tests/unit/pipeline/format-schedule.test.ts`

**5.7 Analytics recording**
- [ ] After successful publish, record in `analytics` table:
  - video_id, platform, published_at, initial_view_count (0)
  - Run 24h and 48h analytics fetch (scheduled, not inline with publish)

### Acceptance Criteria
- [ ] Telegram review request received with format tag and gate summary
- [ ] `/approve` command updates DB and triggers publish
- [ ] Video published to YouTube, TikTok, Instagram via Blotato
- [ ] All `platform_publishes` rows have `is_ai_generated: true`
- [ ] Pinned comment with AI disclosure posted on first publish
- [ ] Platform rate limits enforced (manually verify with 3 rapid publish attempts)
- [ ] Suppression detection fires when given mocked low-analytics data
- [ ] Format schedule selects ring_cam on Monday, body_cam on Tuesday (config default)

### Risk Flags
- Blotato publish confirmation polling may timeout — implement max 10-minute timeout with Telegram alert on timeout
- TikTok AIGC label enforcement varies by region — verify label appears in a test post
- Analytics API rate limits: fetch analytics for all published videos in a single batched call, not per-video

---

## PHASE 6 — Polish + Launch
**Duration:** 12–16 days | **Weeks:** 10–12

### Goals
Comprehensive error handling and monitoring, cost optimization review, 2-week production run with human review of every video, analytics feedback loop, category rotation tuning, and trust threshold calibration.

### Tasks

**6.1 Error handling and monitoring**
- [ ] All pipeline steps wrapped in structured error handling with Telegram alerts
- [ ] Vendor health polling: Supabase, Anthropic, fal.ai, Cloudinary, Blotato (every 30 minutes)
- [ ] Alert Telegram on vendor status change (healthy → degraded)
- [ ] Buffer check: alert when buffer drops below 2 days
- [ ] Budget check: alert at 80% ($40) and 100% ($50) of daily cap
- [ ] `npm run status` accurately reflects all of the above

**6.2 Cost optimization review**
- [ ] Query all `scene_costs` from pilot runs, aggregate by format and sub-type
- [ ] Identify highest-cost sub-type and review whether prompts can be simplified (shorter clips = lower Veo cost)
- [ ] Target: ring cam single video $3–6; body cam single video $5–10; daily max < $50
- [ ] Run cost regression tests: `npm run test:cost`

**6.3 2-week production run (human review of every video)**
- [ ] Enable daily cron (see SKILL.md Cron Setup section)
- [ ] Every video gets human Telegram review before publish for the first 2 weeks
- [ ] Track: gate fail rates, most common fail reasons, re-generation frequency
- [ ] Document recurring issues in this file under "Known Issues" section

**6.4 Analytics feedback loop**
- [ ] After 48 hours: fetch view count, CTR from YouTube and TikTok analytics
- [ ] Store in `analytics` table
- [ ] Implement `src/pipeline/analytics-agent.ts` → `weeklyPerformanceReview()`:
  - Find top-performing category/sub-type by average views
  - Increase category weight in ideator for top performer
  - Decrease weight for consistently under-performing categories
- [ ] Run manually weekly; review output in Telegram

**6.5 Category rotation calibration**
- [ ] After 2 weeks: review which ring cam categories and body cam sub-types perform best
- [ ] Adjust `DEFAULT_FORMAT_SCHEDULE` weights based on data
- [ ] If a category consistently underperforms (< 50% of average views): flag for ideator to reduce generation frequency

**6.6 Trust threshold calibration — semi-auto-publish**
- [ ] After 2 weeks of 100% human review:
  - If a format/category has 0 policy violations and virality scores > 80: eligible for semi-auto
  - Semi-auto: publish without Telegram approval if virality_score > 80 AND all 7 gates pass AND no flags
  - Gate 4 or 7 failure always requires human review — no exceptions
- [ ] Implement `canAutoPublish(video)` logic
- [ ] Write unit tests for trust threshold logic

**6.7 Storage cleanup automation**
- [ ] Implement daily cleanup script (run as part of cron):
  ```bash
  # Delete raw Veo clips older than 7 days
  find $TEMP_DIR/raw -name "*.mp4" -mtime +7 -delete
  # Delete rejected clips immediately
  find $TEMP_DIR/rejected -name "*.mp4" -delete
  ```
- [ ] Cloudinary: set auto-expiry on raw/temporary uploads; keep published videos for 90 days

### Acceptance Criteria
- [ ] Cron runs autonomously for 14 days without manual code intervention
- [ ] 28+ videos reviewed and published across 14 days (2/day cadence)
- [ ] Cost regression tests pass: ring cam $3–6, body cam $5–10, daily < $50
- [ ] Analytics feedback loop runs weekly, adjusts category weights
- [ ] Semi-auto-publish operational for at least one high-trust category
- [ ] Privacy notice published on all platform profiles
- [ ] KNOWN_ISSUES section below documents any patterns observed

### Risk Flags
- Semi-auto-publish risk: Gate 4 and Gate 7 failures must always escalate to human — code this as an unconditional block, not a threshold
- Analytics API quotas: YouTube Data API has 10,000 units/day; batch analytics queries efficiently
- Task Scheduler + WSL2: test the Windows cron setup thoroughly before relying on it for autonomous operation

---

## Session-by-Session Claude Code Guide
**(PRD Section 11.1 equivalent)**

Each session starts with `/caught-on-camera status` to see current state.

### Session 1 — Foundation Setup
```
Goal: npm run smoke-test passes with all 10 tests
Work: npm install, check-env, setup-db, manual FFmpeg overlay test, Gate 7 test
End state: all migrations applied, Gate 7 producing watermarked output, smoke-test green
```

### Session 2 — Overlay + Audio Assets
```
Goal: All overlay PNGs created, audio beds in place
Work: Create/source overlay templates per format/sub-type; source and place audio WAV files
End state: assets/overlays/ and assets/audio_beds/ fully populated; smoke-test test 8+9 green
```

### Session 3 — Ring Cam Ideator
```
Goal: 50+ ring_cam_ideas in DB, all passing sanitizer and dedup
Work: Implement ring-cam-ideator.ts, dedup.ts; bulk ideator run
End state: ideas queue populated; vitest dedup + gate4 unit tests passing
```

### Session 4 — Body Cam Ideator
```
Goal: 50+ body_cam_ideas in DB; police_security kill switch verified
Work: Implement body-cam-ideator.ts; cross-format dedup; ENABLE_POLICE_SUBTYPE=false test
End state: both ideators functional; 100+ total ideas in DB
```

### Session 5 — Producer (Ring Cam)
```
Goal: First real ring cam video generated from an idea via Veo 3.1
Work: producer.ts ring cam branch; fal.ai integration; cost tracking
End state: raw ring cam clip on disk; scene_costs row in DB
```

### Session 6 — Producer (Body Cam)
```
Goal: First real body cam video generated (at least 2 sub-types)
Work: body cam prompt templates in producer.ts; degradation pipeline
End state: raw body cam clips for dashcam and hiker_trail sub-types on disk
```

### Session 7 — All 7 Gates
```
Goal: Gate pipeline runs end-to-end without errors on fixture clips
Work: Complete all gate stubs; gate runner index.ts; integration tests
End state: npm run test:integration passes; Gate 7 watermark confirmed on real output
```

### Session 8 — Overlay + Cloudinary
```
Goal: Overlaid, watermarked video uploaded to Cloudinary
Work: overlay.ts; format-outputs.ts; cloudinary.ts; Cloudinary credentials tested
End state: video with overlay + watermark at Cloudinary URL; both 16:9 and 9:16 variants
```

### Session 9 — Telegram Review
```
Goal: First review request arrives in Telegram; approve/reject cycle working
Work: telegram.ts review flow; approve/reject command handler
End state: /approve and /reject commands update DB correctly
```

### Session 10 — Blotato Publishing
```
Goal: First video published to all platforms via Blotato with compliance metadata
Work: blotato.ts; generateCompliantMetadata(); platform rate limiting
End state: video live on YouTube + TikTok + Instagram with AI disclosure labels
```

### Session 11 — Full Pipeline End-to-End
```
Goal: idea → produce → gates → review → approve → publish runs without intervention
Work: wire all modules; cron-setup; run npm run status to confirm state
End state: first fully automated video published; status dashboard accurate
```

### Session 12 — Monitoring + Polish
```
Goal: Cost regression tests pass; suppression detection operational; analytics feedback loop
Work: analytics-agent.ts; suppression.ts; cost regression tests; 14-day autonomous run begins
End state: system runs daily for 2 weeks with human review via Telegram
```

---

## Known Issues
*(Document recurring issues found during Phase 6 production run here)*

---

## Budget Projection

| Scenario | Daily Cost | Monthly Cost |
|----------|-----------|-------------|
| 2 videos/day, no retries | ~$16–20 | ~$480–600 |
| 3 videos/day, occasional retry | ~$25–35 | ~$750–1,050 |
| 3 videos/day, 2 gate retries avg | ~$40–45 | ~$1,200–1,350 |
| Hard cap (worst case) | $50 | $1,500 |

Target steady-state: $25–35/day at 3 videos/day cadence.
Hard cap $50/day. Warning threshold $40/day.
