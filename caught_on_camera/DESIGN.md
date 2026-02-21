# CAUGHT ON CAMERA — Technical Design Document

**Version:** 1.0
**Date:** 2026-02-21
**Project:** Caught on Camera AI Pipeline
**Runtime:** Node.js 20+ / TypeScript (ESM), WSL2 on Windows 11
**Claude Skill Model:** claude-sonnet-4-6

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Decision: AI vs TypeScript Separation](#2-architecture-decision-ai-vs-typescript-separation)
3. [Data Flow Diagram](#3-data-flow-diagram)
4. [Dual Format Specification](#4-dual-format-specification)
5. [Six-Shield Quality and Risk System](#5-six-shield-quality-and-risk-system)
6. [Seven-Gate Quality Pipeline](#6-seven-gate-quality-pipeline)
7. [AI Degradation Pipeline](#7-ai-degradation-pipeline)
8. [UI Overlay System](#8-ui-overlay-system)
9. [Anti-Repetition and Content Freshness](#9-anti-repetition-and-content-freshness)
10. [Platform Distribution and Resilience](#10-platform-distribution-and-resilience)
11. [Database Schema](#11-database-schema)
12. [Budget Model](#12-budget-model)
13. [Ethics Framework](#13-ethics-framework)
14. [Security and Compliance](#14-security-and-compliance)
15. [Deployment](#15-deployment)

---

## 1. System Overview

### What It Is

Caught on Camera is an autonomous dual-format AI video production pipeline implemented as a Claude Code skill. It generates 3–4 viral-ready short-form videos per day across two completely distinct "found footage" visual formats: **Ring Camera** (static doorbell/porch surveillance footage) and **Body Camera** (first-person POV footage). These are among the most consistently viral content categories on TikTok, YouTube Shorts, and Instagram Reels.

The system maintains two completely separate Ideator Agents — one specialized in Ring Camera scenarios, one specialized in Body Camera scenarios — each with its own creative prompt, virality formula, scoring criteria, and dedicated ideas database table. The Producer Agent handles both formats, switching between static-camera and POV-camera Veo 3.1 prompt templates based on the selected idea's format field. All downstream infrastructure — FFmpeg assembly, multi-format output, Telegram review, Blotato distribution — is shared.

### What It Produces

- 3–4 videos per day (configurable via format schedule)
- Format mix: Ring Cam singles (30s) + Body Cam singles (30–45s) + weekly compilations
- Dual output per video: 16:9 master + 9:16 vertical crop for short-form platforms
- Cloudinary CDN hosting for all published variants
- Simultaneous distribution to YouTube, YouTube Shorts, TikTok, and Instagram Reels via Blotato

### The Found Footage Advantage

The security camera and body camera aesthetic is strategically chosen for an AI production pipeline for one fundamental reason: **AI video artifacts are assets in this format, not liabilities**. Real security cameras look "wrong" — they have compression artifacts, barrel distortion, noise grain, overexposed highlights, and slightly uncanny physics. Viewers expect this. The "uncanny valley" that destroys the credibility of cinematic AI video actually increases the authenticity of found footage AI video.

This design decision runs through the entire system. Every FFmpeg degradation pass, every overlay choice, every audio bed selection is calibrated to make the output look more like a real security camera or body camera — which simultaneously makes it look more real and masks AI generation artifacts.

### Invocation Model

**Claude decides:** concept ideation, Veo prompt generation, prompt sanitization, quality gate evaluation (vision), deduplication semantic check, suppression trend analysis, weekly strategy adjustments.

**TypeScript executes:** FFmpeg degradation + overlay + compositing, Veo API calls via fal.ai, Cloudinary upload, Blotato API publishing, all database reads and writes, cost accounting, cron scheduling, Telegram bot I/O.

### Deployment Context

Runs inside WSL2 Ubuntu on Windows 11 desktop. Windows Task Scheduler fires bridge scripts that call `wsl.exe` to invoke Node.js. Daily budget: $25 target, $40 warning threshold, $50 hard cap.

---

## 2. Architecture Decision: AI vs TypeScript Separation

### The Governing Philosophy

The same philosophy as Cryptid Vlog: Claude decides, TypeScript executes. AI reasoning is expensive, non-deterministic, and hard to test. File I/O, HTTP calls, and FFmpeg operations are cheap, deterministic, and easy to test. The boundary between them must be explicit and enforced.

### What Claude Handles

| Decision | Rationale |
|---|---|
| Concept ideation (Ring Cam Ideator) | Requires creative judgment, virality intuition, category balance |
| Concept ideation (Body Cam Ideator) | Same — separate agent for independent creative voice |
| Veo prompt generation (Producer) | Requires translating concept to technical camera spec language |
| Prompt sanitization (Gate 4A) | Requires semantic understanding of what "counts" as a prohibited concept |
| Keyframe content review (Gate 4B) | Requires vision + policy reasoning on ambiguous imagery |
| Deduplication check | Requires semantic similarity judgment, not keyword matching |
| Overlay quality verification (Gate 6) | Requires visual judgment on whether overlay looks authentic |
| Suppression trend analysis | Requires reasoning over engagement metric patterns |
| Weekly strategy adjustments (Analytics Agent) | Requires connecting performance data to creative direction |

### What TypeScript Handles

| Operation | Rationale |
|---|---|
| FFmpeg degradation pipeline | Deterministic filter parameters, measurable output |
| FFmpeg overlay compositing | Pixel-exact positioning from pre-built templates |
| Veo API calls via fal.ai | HTTP with retry — no AI judgment needed |
| Motion analysis (Gate 1) | Arithmetic on optical flow vectors from vidstabdetect |
| Audio level measurement (Gate 3) | dB measurement — objective |
| Face detection via OpenCV (Gate 2) | Computer vision model — separate from LLM |
| 9:16 crop safety analysis (Gate 5) | Edge density arithmetic on frame regions |
| Disclosure watermark burn (Gate 7) | Deterministic FFmpeg drawtext |
| Cloudinary upload | HTTP POST |
| Blotato API publish | HTTP POST with platform metadata |
| All database reads and writes | CRUD — no reasoning required |
| Cost tracking and cap enforcement | Arithmetic |
| Telegram bot I/O | HTTP — Claude only reads/writes the message content |

### Two-Format Strategy: Same Infrastructure, Format-Switched at Two Points

The dual-format approach doubles content surface area without doubling engineering. The format switch happens at exactly two decision points in the pipeline:

**Point 1 — Idea selection:** Orchestrator checks the day's format schedule and queries either `ring_cam_ideas` or `body_cam_ideas`. Everything upstream of this point (the Ideator runs, the scoring, the dedup) runs independently per format. Everything downstream is shared.

**Point 2 — Prompt generation:** Producer Agent receives the idea plus a `format` field and selects the appropriate Veo prompt template block (Ring Cam static spec vs. Body Cam POV spec + sub-type). Everything downstream of this point is format-agnostic: the same gate runner, the same FFmpeg commands (with format-specific parameters), the same Cloudinary upload, the same Blotato publish.

```
Ring Cam Ideator ──────────────────────────────┐
  (ring_cam_ideas table)                        │
                                                ▼
                                    Orchestrator: format check
                                                │
Body Cam Ideator ──────────────────────────────┘
  (body_cam_ideas table)                        │
                                                ▼
                                    Producer: prompt template switch
                                                │
                          ┌─────────────────────┴────────────────────┐
                          │                                           │
                   Ring Cam template                        Body Cam template
                   (static spec)                            (POV spec + sub-type)
                          │                                           │
                          └─────────────────────┬────────────────────┘
                                                │
                                         Veo 3.1 API
                                                │
                                    Shared gate pipeline (1-7)
                                                │
                                    Shared FFmpeg assembly
                                                │
                                    Cloudinary → Telegram → Blotato
```

---

## 3. Data Flow Diagram

### Full Pipeline Flow

```
═══════════════════════════════════════════════════════════════════
  IDEATOR RUNS (3x/week — Monday/Wednesday/Friday, configurable)
═══════════════════════════════════════════════════════════════════

  Ring Cam Ideator                    Body Cam Ideator
  (Claude Sonnet)                     (Claude Sonnet)
       │                                    │
       │  15-20 concepts                    │  15-20 concepts
       │  virality scored 1-10              │  virality scored 1-10
       │  category-rotation weighted        │  category-rotation weighted
       │  30-day semantic dedup             │  30-day semantic dedup
       ▼                                    ▼
  ring_cam_ideas table              body_cam_ideas table


═══════════════════════════════════════════════════════════════════
  DAILY PIPELINE RUN (8:00 AM via Windows Task Scheduler)
═══════════════════════════════════════════════════════════════════

START
  │
  ├─[1] ENV VALIDATION (src/config.ts)
  │     Zod validates all required vars → EXIT 1 + Telegram alert if missing
  │
  ├─[2] BUDGET CHECK (src/db/costs.ts)
  │     Query costs for today → if spend >= $50 hard cap → ABORT
  │     Alert at $40 warning threshold
  │
  ├─[3] BUFFER CHECK (src/monitoring/buffer.ts)
  │     Count approved-unpublished videos → if >= BUFFER_MAX (5) → SKIP generation
  │
  ├─[4] FORMAT SELECTION (src/pipeline/orchestrator.ts)
  │     Read FORMAT_SCHEDULE → determine today's format (ring_cam or body_cam)
  │     Sunday: query highest virality_score from EITHER table
  │
  ├─[5] IDEA SELECTION
  │     Pull highest virality_score, status='pending' idea from appropriate table
  │     Mark status='in_production'
  │
  ├─[6] PRODUCER AGENT (Claude) (src/pipeline/producer.ts)
  │     │
  │     ├─ Select format template (Ring Cam or Body Cam + sub-type)
  │     ├─ Generate Veo prompt: [CAMERA SPEC] + [ENVIRONMENT] + [LIGHTING] + [ACTION] + [AUDIO]
  │     ├─ GATE 4A: Prompt sanitizer (before Veo call)
  │     │   ├─ PASS → continue to Veo
  │     │   └─ FAIL → rewrite prompt or reject concept, select next idea
  │     └─ Define FFmpeg overlay config (format + sub-type specific)
  │
  ├─[7] VIDEO GENERATION (src/ai/veo.ts)
  │     fal.ai Veo 3.1 text-to-video API
  │     8s base clip → extend to 30s (Ring Cam) or 30-45s (Body Cam)
  │     Max 3 retries on failure
  │     Save raw output to /tmp/caught_on_camera/scenes/{id}/raw.mp4
  │
  ├─[8] QUALITY GATE PIPELINE (src/gates/)
  │     │
  │     ├─[GATE 1] Motion Analysis (TypeScript + FFmpeg vidstabdetect)
  │     │   Ring Cam: avg motion > 0.5px/frame → REJECT, regenerate
  │     │   Body Cam: avg motion < 1.5px/frame → inject shake, continue
  │     │
  │     ├─[GATE 2] Face Detection + Auto-Blur (Python/OpenCV → FFmpeg)
  │     │   Detect faces → auto-blur → ALWAYS PASS (blur = authenticity)
  │     │
  │     ├─[GATE 3] Audio Validation (TypeScript + FFmpeg volumedetect)
  │     │   Silence check + format volume range → fallback to audio bed
  │     │
  │     ├─[GATE 4B] Content Review (Claude vision on 5 keyframes)
  │     │   Policy flags → HARD FAIL: abort, alert, select next idea
  │     │
  │     ├─[GATE 5] Crop Safety (TypeScript edge density analysis)
  │     │   Off-center → graceful degrade to YouTube 16:9 only (no fail)
  │     │
  │     ├─[DEGRADATION PIPELINE] (FFmpeg — see Section 7)
  │     │   Ring Cam: barrel → unsharp → desaturate → noise → CRF 28
  │     │   Body Cam: mild barrel → auto-exposure sim → noise → CRF 26
  │     │   Body Cam shake injection if Gate 1 triggered it
  │     │
  │     ├─[GATE 6] Overlay Compositing + Quality Check
  │     │   FFmpeg: PNG template overlay + drawtext timestamp
  │     │   Claude vision: verify overlay applied correctly → retry if cheap
  │     │
  │     └─[GATE 7] Disclosure Watermark (HARD FAIL if missing)
  │         FFmpeg drawtext: "AI GENERATED" bottom-right, 40% opacity
  │         Verification: extract frame, confirm text present
  │
  ├─[9] MULTI-FORMAT OUTPUT (src/media/ffmpeg.ts)
  │     16:9 master (1920×1080) + 9:16 vertical (1080×1920, center crop)
  │     (Body Cam clips flagged "16:9 only" skip vertical crop)
  │
  ├─[10] CLOUDINARY UPLOAD (src/platforms/cloudinary.ts)
  │      Both variants uploaded → store URLs in videos table
  │
  ├─[11] HUMAN REVIEW (src/monitoring/telegram.ts)
  │      Send reviewRequest() with format tag ([RING CAM] or [BODY CAM])
  │      Include: Cloudinary preview URL, idea title, virality score, gate results
  │      Operator: ✅ approve {id} | ❌ reject {id} [reason]
  │      status = 'pending_review' → wait for operator response
  │
  ├─[12] PUBLISH (src/pipeline/publisher.ts) [fires on approval]
  │      Blotato API → YouTube + YouTube Shorts + TikTok + Instagram Reels
  │      Per-platform compliance metadata (isAiGenerated, disclosure text)
  │      Auto-post pinned comment via Blotato comment API
  │      Update videos.status = 'published', store post IDs
  │
  └─[13] MONITORING REPORT (src/monitoring/telegram.ts)
         Daily summary: cost breakdown, gate pass/fail, format schedule tomorrow
```

### Ring Cam vs Body Cam Path Divergence

```
Shared Start: Orchestrator selects format → fetches idea from table
                                │
              ┌─────────────────┴──────────────────┐
              │                                    │
         RING CAM PATH                       BODY CAM PATH
              │                                    │
   Template: static spec                Template: POV spec
   "locked-off, no movement"            + sub-type (police/hiker/
   fisheye doorbell mount               dashcam/helmet)
              │                                    │
   Veo clip: 30s                        Veo clip: 30-45s
              │                                    │
   Gate 1: reject if ANY                Gate 1: reject if TOO
   camera motion > 0.5px               STABLE < 1.5px → add shake
              │                                    │
   Degradation: heavy barrel,           Degradation: mild barrel,
   desaturate 0.75, CRF 28             auto-exposure sim, CRF 26
              │                                    │
   Overlay: HomeCam/DoorView            Overlay: UNIT 247 / CAM-03
   timestamp + camera name             + optional GPS / speed
   MOTION DETECTED flash                REC indicator, military time
              │                                    │
              └─────────────────┬──────────────────┘
                                │
              Shared: disclosure watermark → multi-format →
              Cloudinary → Telegram review → Blotato publish
```

---

## 4. Dual Format Specification

### 4.1 Format Comparison Table

| Property | Ring Camera | Body Camera |
|---|---|---|
| Camera Motion | NONE — completely static, locked-off | CONSTANT — walking bob, running shake, head turns |
| Perspective | 3rd-person surveillance (watching from above/beside) | 1st-person POV (viewer IS the person wearing the camera) |
| Lens | Wide-angle (160°+) with heavy barrel distortion | Wide-angle (120–140°) with moderate barrel distortion |
| Mount Position | Doorbell (3.5–4.5ft) or porch overhead (8–10ft) | Chest-mounted (4ft), helmet, vehicle dashboard |
| Stabilization | N/A — static mount | Partial — still visibly body-mounted |
| Audio | Ambient only (wind, birds, footsteps, muffled speech) | Close-mic: breathing, footsteps, radio chatter, direct speech |
| Setting | Residential exterior only (porch, driveway, yard) | Anywhere: streets, woods, buildings, vehicles, trails |
| Resolution Feel | 1080p but soft, compressed, slightly desaturated | 720p–1080p, more compression, auto-exposure struggles |
| Night Mode | IR grayscale with glowing eyes, center-bright falloff | Green-tinted NV, or flashlight-only, or streetlight |
| UI Overlay | Timestamp, camera name, pulsing recording dot, MOTION DETECTED | Military timestamp, unit ID, REC indicator, optional GPS/speed |
| Virality Driver | Voyeurism: "look what the camera caught" | Immersion: "you ARE the person this is happening to" |
| Emotional Hook | Surprise + relatability (could happen at YOUR house) | Adrenaline + mystery (viewer's nervous system responds as if present) |
| Clip Duration | 30s (target) | 30–45s (target) |
| Veo Cost | $3.00–4.50 | $4.50–6.75 |

### 4.2 Ring Camera Visual Specification

| Property | Specification | Veo Prompt Keywords |
|---|---|---|
| Lens | 160°+ wide-angle with barrel distortion | "wide-angle security camera lens", "fisheye doorbell camera" |
| Mount | Doorbell (3.5–4.5ft) or overhead porch (8–10ft) | "mounted at door height", "elevated porch camera looking down" |
| Motion | ZERO | "static fixed camera", "no camera movement", "locked off" |
| Field of View | Front porch, walkway, driveway, part of street | "front porch view", "suburban driveway" |
| Resolution | 1080p but soft and compressed | "security camera footage quality", "compression artifacts" |
| Day Color | Slightly desaturated, occasional overexposure | "muted colors", "security camera color grading" |
| Night IR | Grayscale, IR illuminator falloff from center | "infrared grayscale", "IR illumination", "glowing eyes" |
| Subject Position | Must be centered in middle third of frame | "subject centered in middle third of wide frame" |

### 4.3 Body Camera Sub-Types

#### Police/Security Body Cam
- Mount: Chest-mounted, 4ft height, widest angle
- Motion: Walking bob, turning, occasional stop-and-hold
- Audio: Radio chatter, commands, dispatcher voice, flashlight beam clicks, footsteps on pavement
- Settings: Streets, parking lots, neighborhoods, building exteriors
- Overlay: UNIT 247 / SECURITY PATROL, military timestamp, GPS coordinates bottom-left
- Veo anchor: `"police body camera footage, chest-mounted, first person POV, radio chatter, flashlight beam"`
- Ethics constraint: No arrests, no use of force, no civilian confrontation — see Section 13

#### Hiker/Trail Cam
- Mount: Chest or helmet-mounted, trails and wilderness
- Motion: Walking bob, crouching, turning toward sounds
- Audio: Heavy breathing, rustling foliage, snapping twigs, wind, boots on dirt
- Settings: Forests, mountains, trails, campsites, remote roads
- Overlay: Minimal — timestamp + REC, no GPS
- Veo anchor: `"hiker chest-mounted body camera footage, first-person POV on trail, camera bobs with each step, wide-angle, close mic capturing heavy breathing and boots on dirt"`

#### Dashcam
- Mount: Dashboard-mounted, forward-facing through windshield
- Motion: Steady forward perspective with vehicle vibration
- Audio: Engine/road noise, music/radio, wiper sounds, horn
- Settings: Roads, highways, intersections, parking lots
- Overlay: Timestamp + CAM-03, speed readout bottom-right (e.g., "47 MPH")
- Veo anchor: `"dashboard-mounted camera looking forward through windshield, slight dashboard vibration, wide-angle view of road ahead, engine and road noise, windshield reflections"`

#### Helmet/Action Cam
- Mount: Helmet or head-mounted, most head-turn movement
- Motion: Aggressive head turns, ducking, looking up/down
- Audio: Wind noise, muffled speech, impact sounds, heavy breathing
- Settings: Construction, extreme sports, rescue operations, urban exploration
- Overlay: Timestamp + unit ID, no GPS
- Veo anchor: `"helmet-mounted camera footage, first person POV, head movement, wind noise"`

### 4.4 Veo Prompt Templates

#### Ring Camera Master Template

Structure: `[CAMERA SPEC] + [ENVIRONMENT] + [LIGHTING] + [ACTION] + [AUDIO] + [QUALITY ANCHORS]`

**Camera Spec Block (prepended to every Ring Cam prompt):**
```
"Static fixed wide-angle security camera footage, doorbell camera mounted at 4 feet
height, 160-degree fisheye lens with barrel distortion, no camera movement whatsoever,
locked-off surveillance perspective, subject centered in middle third of wide frame"
```

**Night IR Variant block:**
```
"Static fixed wide-angle security camera night vision footage, infrared illumination,
grayscale monochrome with IR falloff, doorbell camera at 4 feet height, 160-degree
fisheye, animal eyes glow bright white from IR reflection, no camera movement"
```

**Example — Raccoon Beer Thief:**
```
"Static fixed wide-angle security camera footage, doorbell camera at 4 feet, 160-degree
fisheye with barrel distortion. Suburban front porch at dusk, warm porch light, cooler
near steps. Large raccoon waddles up walkway, uses both paws to flip cooler lid, pulls
out a beer can, tucks under one arm, waddles into darkness. Audio: crickets, distant
traffic, cooler lid click, raccoon chittering. Security camera quality, desaturated,
compression artifacts."
```

#### Body Camera Master Template

Structure: `[CAMERA SPEC] + [MOVEMENT] + [ENVIRONMENT] + [LIGHTING] + [ENCOUNTER] + [AUDIO] + [QUALITY ANCHORS]`

**Police/Security Spec block:**
```
"Police body camera footage, chest-mounted at 4 feet, first-person POV, wide-angle with
slight barrel distortion, camera moves with officer's walking motion, natural body sway
and bob, partially stabilized, close microphone capturing breathing and footsteps"
```

**Hiker/Trail Spec block:**
```
"Hiker chest-mounted body camera footage, first-person POV on trail, camera bobs with
each step, wide-angle, natural forest lighting, close mic capturing heavy breathing and
boots on dirt"
```

**Dashcam Spec block:**
```
"Dashboard-mounted camera looking forward through windshield, slight dashboard vibration,
wide-angle view of road ahead, engine and road noise, windshield reflections, steady
forward perspective"
```

**Night Vision block (any sub-type):**
```
"Body camera night vision footage, green-tinted monochrome, limited visibility, flashlight
beam cutting through darkness, close mic breathing and footsteps amplified in silence,
grainy night vision quality"
```

**Example — Night Trail Encounter:**
```
"Hiker chest-mounted body camera, first-person POV, night vision green tint, walking
slowly on forest trail, flashlight beam sweeping ahead, heavy breathing on close mic,
boots crunching dry leaves. Flashlight catches two glowing eyes 30 feet ahead at ground
level. Wearer stops — eyes don't move. Silence except breathing getting faster. Wearer
slowly backs up, then eyes rise higher as animal stands. Wearer turns and walks quickly
back, flashlight bouncing. Body camera quality, grainy NV, slight motion blur."
```

**Example — Dashcam Storm:**
```
"Dashboard camera looking forward through windshield, daytime turning dark as massive
storm approaches. Two-lane highway, wipers on full, heavy rain. Lightning strikes tree
50 feet off-road, tree splits and falls toward road. Driver swerves left, narrowly
missing tree, horn from oncoming lane. Dashboard camera quality, rain distortion,
engine roar, thunder audio, dashboard vibration."
```

### 4.5 Format Schedule

The orchestrator reads `FORMAT_SCHEDULE` from environment config. Default rotation:

| Day | Format | Content Focus |
|---|---|---|
| Monday | Ring Cam | Animals (highest virality) |
| Tuesday | Body Cam | Night patrol / police-security sub-type |
| Wednesday | Ring Cam | Compilation (best of week) |
| Thursday | Body Cam | Trail / wildlife encounter (hiker sub-type) |
| Friday | Ring Cam | Paranormal / night shift |
| Saturday | Body Cam | Compilation (themed) |
| Sunday | Operator's choice | Highest virality_score from either table |

Override via Telegram: `/schedule monday body_cam` — updates `FORMAT_SCHEDULE` env var for next run.

---

## 5. Six-Shield Quality and Risk System

The Risk Elimination Plan defines six independent protection layers ("shields") that together reduce production risk to near-zero. Each shield maps to specific risks identified in PRD Section 12. They are built in priority order during implementation (see Section 6 gate priority table).

### Shield Overview

```
┌─────────────────────────────────────────────────────────────────┐
│              SIX-SHIELD RISK ELIMINATION SYSTEM                 │
├───────────────────────┬─────────────────────────────────────────┤
│  SHIELD 1: TECHNICAL  │  7 automated quality gates              │
│                       │  No clip reaches review without passing  │
├───────────────────────┼─────────────────────────────────────────┤
│  SHIELD 2: LEGAL      │  4-layer AI disclosure + attorney review │
│                       │  Quarterly compliance audits             │
├───────────────────────┼─────────────────────────────────────────┤
│  SHIELD 3: PLATFORM   │  Suppression detection + rate limits     │
│                       │  Backup accounts + Blotato fallback      │
├───────────────────────┼─────────────────────────────────────────┤
│  SHIELD 4: CONTENT    │  30-day semantic dedup + category rotate │
│                       │  AI artifact masking via degradation     │
├───────────────────────┼─────────────────────────────────────────┤
│  SHIELD 5: ETHICS     │  Triple-layer police guardrails          │
│                       │  Kill switch + sensitivity calendar      │
├───────────────────────┼─────────────────────────────────────────┤
│  SHIELD 6: OPERATIONS │  $50 hard cap + $40 warning             │
│                       │  3-day content buffer + storage cleanup  │
└───────────────────────┴─────────────────────────────────────────┘
```

### Shield 1: Technical Shield

The seven-gate automated quality pipeline (detail in Section 6). Every generated clip must pass all seven gates before reaching the Telegram review queue. Gates execute sequentially; hard-fail gates abort and alert; soft-fail gates attempt remediation before marking degraded. No manual intervention required for normal soft-fail cases.

**Risks eliminated:** Camera motion artifacts (Ring Cam), gimbal-smooth Body Cam, recognizable AI faces, artificial audio, off-center vertical crops, cheap-looking overlays, missing disclosure watermark.

### Shield 2: Legal Shield

Four independent AI disclosure layers applied to every published video:
1. "AI GENERATED" text burned into video file (Gate 7, permanent, survives re-upload)
2. `isAiGenerated: true` in Blotato API metadata for TikTok and Instagram
3. YouTube description: "This content is AI-generated and does not depict real events" (first line)
4. Pinned comment auto-posted via Blotato comment API on every video

Pre-launch: attorney review of disclosure language, overlay text for impersonation risk, and platform TOS compliance ($500–1,000 one-time). Quarterly: re-read platform policies, update compliance matrix, attorney follow-up if legal landscape changed.

**Risks eliminated:** Synthetic media law violations (CA, TX, NY, EU AI Act), trademark issues, right-of-publicity, account suspension for non-disclosure.

### Shield 3: Platform Shield

Suppression monitoring compares 7-day rolling average views against 30-day historical average per platform. Alerts at <60% ratio (WARNING), auto-redistributes posting at <30% ratio (CRITICAL). Per-platform posting rate limits enforced by `posting_guardrails.ts` to prevent ban triggers. Backup accounts warmed up and held in reserve on all four platforms. Blotato failures degrade to manual upload queue with Cloudinary URLs sent via Telegram.

**Risks eliminated:** Algorithmic suppression survivability, account ban prevention, distribution continuity during Blotato outages.

### Shield 4: Content Shield

Thirty-day cross-format semantic deduplication using Claude (not keyword matching). Category rotation with inverse weighting — underused categories get higher Ideator prompting weight, overused categories get lower weight. AI artifact masking through intentional video degradation (see Section 7). The found footage format converts AI weaknesses into authenticity signals.

**Risks eliminated:** Audience fatigue from repetition, AI "tells" becoming recognizable, compilation quality inconsistency.

### Shield 5: Ethics Shield

Triple-layered protection specifically for police body cam content (see Section 13 for full detail): hardcoded Ideator prohibitions at prompt level, pre-Veo keyword sanitizer at Gate 4A, post-Veo Claude keyframe review at Gate 4B. Kill switch via `ENABLE_POLICE_SUBTYPE` env var, toggleable via Telegram `/disable police` in under 30 seconds. Sensitivity calendar for manual pauses after real-world events. Auto-responses to "is this real?" comments via Blotato comment API.

**Risks eliminated:** Police violence trivialization, impersonation of law enforcement, erosion of public trust in video evidence.

### Shield 6: Operations Shield

Cost system: `checkBudget()` before every Veo API call — hard abort at $50/day, Telegram warning at $40, normal target $25. Content buffer: `checkBuffer()` monitors approved-unpublished count — alert below 1 day of buffer, extra generation cycle triggered. Storage cleanup: raw Veo outputs deleted after 7 days, rejected clips deleted immediately, approved videos archived after 90 days. Sequential (not parallel) Veo generation keeps API calls well within rate limits.

**Risks eliminated:** Cost overruns, storage accumulation, API rate limit bans, operator burnout.

---

## 6. Seven-Gate Quality Pipeline

Every generated clip passes through all seven gates in sequence. The gate runner in `src/gates/index.ts` orchestrates execution, enforces hard-fail semantics, and aggregates results into the `gate_results` JSONB field on the `scenes` table.

### Gate Priority Table (Implementation Order)

| Priority | Gate | Shield | Build Phase | Reason |
|---|---|---|---|---|
| 1 | Gate 7: Disclosure Watermark | Legal | Phase 1 (Week 1) | Legal compliance before ANY video generated |
| 2 | Legal Shield (attorney review) | Legal | Phase 1 (Week 1–2) | Before content creation begins |
| 3 | Gate 4: Content Policy (both stages) | Ethics + Technical | Phase 2 (Week 3) | Before Ideator generates concepts |
| 4 | Gate 1: Motion Analysis | Technical | Phase 4 (Week 5) | When Producer starts generating video |
| 5 | Gate 2: Face Detection | Technical | Phase 4 (Week 5) | When Producer starts generating video |
| 6 | Gate 3: Audio Validation | Technical | Phase 4 (Week 6) | After initial generation is working |
| 7 | Ethics kill switch | Ethics | Phase 4 (Week 6) | Before police sub-type activated |
| 8 | Gate 5: Crop Safety | Technical | Phase 4 (Week 6) | Before multi-format output |
| 9 | Gate 6: Overlay Quality | Technical | Phase 5 (Week 7) | When overlay assets ready |
| 10 | Platform Shield | Platform | Phase 5 (Week 8) | Alongside Blotato integration |
| 11 | Content Shield (dedup) | Content | Phase 2–3 (Week 3–5) | As Ideators come online |
| 12 | Operations Shield | Operations | Phase 6 (Week 10) | Production readiness |

### Gate 1: Motion Analysis

**File:** `src/gates/gate1-motion.ts`
**Eliminates:** Ring Cam camera drift (Risk 12.1.1), Body Cam gimbal-smooth output (Risk 12.1.2)
**Implementation:** FFmpeg `vidstabdetect` extracts optical flow vectors. TypeScript parses the transform file for average motion magnitude per frame and peak spike.

**Pass/Fail Criteria:**

| Format | Threshold | Pass | Fail | Action on Fail |
|---|---|---|---|---|
| Ring Cam | avg motion | < 0.5 px/frame AND peak < 2.0px | Either exceeded | Hard fail: reject, regenerate with reinforced static prompt (max 3 retries) |
| Body Cam | avg motion | > 1.5 px/frame | Below threshold | Soft remediation: inject synthetic shake, continue |

**Body Cam shake injection (if Veo output too smooth):**

```bash
ffmpeg -i smooth_clip.mp4 \
  -vf "rotate='0.005*sin(2*PI*t*1.8)':fillcolor=none, \
       crop=iw-20:ih-20:10+5*sin(2*PI*t*0.7):10+3*sin(2*PI*t*1.1)" \
  -c:a copy body_cam_shaken.mp4
```

Sinusoidal rotation + crop offset at 1.8 Hz (natural walking frequency). The 20px crop margin hides rotation edge artifacts.

**Ring Cam reinforce prompt (on regeneration):**
```
CRITICAL: Absolutely zero camera movement. Completely static locked-off frame.
The camera is bolted to a wall. It does not pan, tilt, zoom, or drift in any direction.
```

### Gate 2: Face Detection and Auto-Blur

**File:** `src/gates/gate2-face.ts`
**Eliminates:** Recognizable AI-generated faces (Risk 12.1.3), right-of-publicity (Risk 12.2.5)
**Implementation:** Python 3 + OpenCV DNN face detector (ResNet SSD). Falls back to Claude vision face detection if Python/OpenCV not available.
**Fail type:** Always passes — blur is applied automatically and actually increases authenticity

**Detection approach:**

```python
# Uses res10_300x300_ssd_iter_140000.caffemodel
# Checks every 5th frame for performance
# 50% confidence threshold
# Outputs faces.json with {frame, time, confidence, box} per detection
```

**Blur application (FFmpeg):**

```bash
ffmpeg -i input.mp4 \
  -filter_complex "[0:v]split[original][blur];
    [blur]boxblur=25:25[blurred];
    [original][blurred]overlay=x='if(between(t,START,END),X,-9999)':y='...'" \
  -c:a copy output_blurred.mp4
```

**Decision tree:**
- 0 faces detected → pass through, no modification
- Faces detected → auto-blur → log detection → pass (blurred faces boost found footage authenticity; real released bodycam footage always blurs faces)
- OpenCV unavailable → Claude vision fallback: extract 5 keyframes, ask Claude to identify any clearly visible faces, apply blur boxes if found

**Gate always passes.** Face blur is remediation, not rejection.

### Gate 3: Audio Validation

**File:** `src/gates/gate3-audio.ts`
**Eliminates:** Body Cam artificial or mismatched audio (Risk 12.1.5)
**Implementation:** FFmpeg `volumedetect` measures mean volume in dBFS. Format-specific thresholds.

**Pass/Fail Criteria:**

| Condition | Ring Cam | Body Cam | Action |
|---|---|---|---|
| Nearly silent | mean < -40 dBFS | mean < -40 dBFS | Fail: regenerate clip |
| Too loud | mean > -10 dBFS | N/A | Fail: Ring Cam ambient should be quiet |
| Too quiet | N/A | mean < -35 dBFS | Soft fail: replace with audio bed |
| In range | -40 to -10 dBFS | -35 to -8 dBFS | Pass |

**Audio bed fallback system:**

When Veo audio is borderline, pre-built ambient beds are mixed at -15 dBFS under the Veo audio:

```bash
ffmpeg -i veo_clip.mp4 -i assets/audio_beds/hiker_trail_night.wav \
  -filter_complex "[1:a]volume=-15dB[bed];[0:a][bed]amix=inputs=2:duration=first[mixed]" \
  -map 0:v -map "[mixed]" -c:v copy output.mp4
```

When Veo audio is completely failed, the bed replaces it entirely.

**Audio bed files** (see Section 8 for full asset directory listing):
- Ring Cam: 4 WAV files (day suburban, night crickets, night IR hum, weather rain)
- Body Cam: 8 WAV files per sub-type (see Section 8)

### Gate 4: Content Policy (HARD FAIL)

**File:** `src/gates/gate4-policy.ts`
**Eliminates:** Veo safety filter blocks (Risk 12.1.4), body cam policy flags (Risk 12.3.3), police violence trivialization (Risk 12.5.1)
**Fail type:** HARD FAIL — abort current idea, select next highest-scored idea from table, alert operator

**Two-stage architecture:**

**Stage A: Pre-Veo Prompt Sanitizer (TypeScript)**

Runs before the Veo API call. Catches prohibited content at the cheapest possible point (zero Veo cost).

```typescript
const BLOCKED_WORDS_ALWAYS = [
  'weapon', 'gun', 'knife', 'blood', 'injury', 'wound', 'dead', 'kill',
  'arrest', 'handcuff', 'taser', 'pepper spray', 'use of force',
  'traffic stop', 'pull over', 'suspect', 'perpetrator', 'criminal',
  'child', 'minor', 'nude', 'explicit',
];

const REWRITE_MAP: Record<string, string> = {
  'ghost':           'dark shadow figure',
  'demon':           'unexplained dark shape',
  'attack':          'sudden rapid approach',
  'chase':           'rapid movement toward',
  'scream':          'loud startled vocalization',
  'police officer':  'security patrol person',
  'cop':             'patrol worker',
  'badge':           'ID tag',
  'siren':           'alert tone',
  'gun shot':        'loud sharp sound',
  'explosion':       'bright flash and loud sound',
};
```

- Words in `BLOCKED_WORDS_ALWAYS` → reject prompt entirely, select next idea
- Words in `REWRITE_MAP` → auto-rewrite and continue (log rewrites to `content_flags` table)

**Stage B: Post-Veo Keyframe Review (Claude Vision)**

After Veo generates the clip, 5 evenly-spaced keyframes are extracted and sent to Claude with a structured content policy prompt:

```
CHECK FOR AND FLAG:
1. Any recognizable human faces (should be obscured/distant/turned away)
2. Any depiction of violence, confrontation, or use of force
3. Any content that could be mistaken for real law enforcement footage of an actual incident
4. Any weapons visible in frame
5. Any content that could cause genuine panic or distress if taken out of context
6. Any indoor scenes (Ring Cam should be exterior only)
7. Any branded logos or trademarked elements visible

Respond ONLY with JSON: {"pass": true/false, "flags": ["list"], "severity": "none|low|medium|high|critical"}
```

- severity "high" or "critical" → HARD FAIL → log to `content_flags`, alert operator, select next idea
- severity "low" or "medium" → soft flag → log to `content_flags`, continue to next gate

### Gate 5: Crop Safety

**File:** `src/gates/gate5-crop.ts`
**Eliminates:** Vertical crop cutting key content (Risk 12.1.6)
**Fail type:** Graceful degradation (not a fail) — clips with off-center action still publish to YouTube 16:9 only

**Implementation:**

FFmpeg extracts 1 frame every 2 seconds. Edge detection (`edgedetect=low=0.1:high=0.3`) identifies where visual action/movement is concentrated. The safe zone for 9:16 center crop from 16:9 is the center 56.25% of frame width (420px from each edge in a 1920px-wide frame). If >40% of detected edge density falls outside this zone, the clip is flagged "16:9 only."

**Outcomes:**

```typescript
// PASS with full vertical support
{ pass: true, cropSafe: true }

// PASS with graceful degradation — publish 16:9 only, skip Shorts/Reels/TikTok
{ pass: true, cropSafe: false, reason: 'Key action in left third of frame' }
```

The Veo prompt mitigation: Ring Cam prompts include "subject centered in middle third"; Body Cam prompts specify "key action occurs ahead of the wearer in center of frame." Gate 5 catches the cases where Veo ignores this guidance despite prompting.

### Gate 6: Overlay Quality

**File:** `src/gates/gate6-overlay.ts`
**Eliminates:** Cheap or inconsistent overlay appearance (Risk 12.1.7)
**Fail type:** Soft — retry overlay compositing once if Claude scores it poorly

**Process:**
1. TypeScript runs FFmpeg overlay compositing (PNG template + drawtext — see Section 8)
2. Extract 3 frames from overlaid clip
3. Claude vision assesses: "Does this overlay look like it belongs on the original footage? Does the timestamp position, opacity, and font match a real [Ring Cam / Body Cam] UI? Is the recording indicator visible? Is the text readable but not distracting?"
4. Claude returns `{ pass: boolean, score: number, issues: string[] }`
5. score < 70 → retry compositing with adjusted parameters → fail if retry also scores < 70

### Gate 7: Disclosure Watermark (HARD FAIL)

**File:** `src/gates/gate7-disclosure.ts`
**Eliminates:** Synthetic media law non-compliance (Risk 12.2.1), account suspension for non-disclosure
**Fail type:** HARD FAIL if watermark not present — re-assemble with watermark and re-verify

**Burn command:**

```bash
ffmpeg -i approved_clip.mp4 \
  -vf "drawtext=text='AI GENERATED': \
    x=w-tw-15:y=h-th-15:fontsize=11:fontcolor=white@0.4: \
    fontfile=assets/overlays/ring_cam/font_ocr_b.ttf" \
  -c:a copy final_output.mp4
```

Position: bottom-right corner, 15px from edges. Opacity: 40% (visible if you look, non-distracting). Font: OCR-B monospace (matches the security camera aesthetic naturally).

**Verification:**

After burn, extract 1 frame from the last quarter of the video and send to Claude vision: "Is there text reading 'AI GENERATED' visible in the bottom-right corner? Respond with JSON: `{present: boolean, readable: boolean}`"

- `present: false` OR `readable: false` → HARD FAIL → re-run burn command → re-verify → if still failing, alert operator and abort publish

This is the last gate before the video enters the Telegram review queue. A video cannot reach human review without the disclosure watermark verified present.

---

## 7. AI Degradation Pipeline

### The Strategic Rationale

AI video artifacts look wrong in cinematic content but look right in found footage. This is the most important insight in the entire system architecture. Real security cameras and body cameras have:

- Barrel distortion from wide-angle lenses
- Slightly soft, unsharp imagery (not 4K crisp)
- Compression artifacts from low-bitrate recording
- Color desaturation and contrast oddities
- Noise grain, especially in low light
- Body-mounted cameras have motion blur on fast movement

Veo 3.1 generates these naturally — but inconsistently. The degradation pipeline applies them systematically, so every output clip looks consistent and authentic regardless of what Veo happened to produce. It also masks any residual AI-generation artifacts (texture flickering, unnatural physics) by adding the visual noise that real cameras produce.

**Pipeline position:** Degradation is applied AFTER Veo generation and AFTER Gate 1–3 validation, but BEFORE overlay compositing. The overlay is always applied on top of the degraded footage, never on the raw Veo output.

```
Veo raw output
     │
     ├─ Gate 1 (motion analysis on raw output)
     ├─ Gate 2 (face detection on raw output)
     ├─ Gate 3 (audio validation on raw output)
     │
     ▼
DEGRADATION PIPELINE ← you are here
     │
     ▼
Gate 6 (overlay compositing on degraded output)
     │
     ▼
Gate 7 (disclosure watermark on overlaid output)
```

### Ring Camera Degradation Chain

```bash
ffmpeg -i veo_output.mp4 \
  -vf " \
    lenscorrection=k1=-0.22:k2=0.02, \
    unsharp=3:3:-0.5:3:3:-0.5, \
    eq=saturation=0.75:contrast=1.1, \
    noise=alls=8:allf=t \
  " \
  -c:v libx264 -crf 28 \
  -c:a aac -b:a 96k \
  ring_cam_degraded.mp4
```

| Filter | Parameters | Effect |
|---|---|---|
| `lenscorrection` | k1=-0.22, k2=0.02 | Barrel distortion matching 160° fisheye lens |
| `unsharp` | 3:3:-0.5 (negative sharpen = blur) | Reduces Veo's over-sharpness to match real security cam |
| `eq` | saturation=0.75, contrast=1.1 | Slightly washed-out security camera color grading |
| `noise` | alls=8, allf=t (temporal noise) | Subtle grain across all frames |
| CRF | 28 (high compression) | Compression artifacts matching low-bitrate security recording |
| Audio | 96k AAC | Matches low-bitrate ambient audio capture |

### Body Camera Degradation Chain

```bash
ffmpeg -i veo_output.mp4 \
  -vf " \
    lenscorrection=k1=-0.12:k2=0.01, \
    curves=master='0/0.05 0.5/0.55 1/0.95', \
    noise=alls=12:allf=t \
  " \
  -c:v libx264 -crf 26 \
  -c:a aac -b:a 128k \
  body_cam_degraded.mp4
```

| Filter | Parameters | Effect |
|---|---|---|
| `lenscorrection` | k1=-0.12, k2=0.01 | Mild barrel distortion (120–140° lens, less than Ring Cam) |
| `curves` | master curve pulled dark at shadows, bright at midrange | Auto-exposure simulation — the struggle between dark shadows and blown highlights that body cams exhibit |
| `noise` | alls=12, allf=t | More noise than Ring Cam (body cams have worse sensors) |
| CRF | 26 (moderate compression) | Slightly better quality than Ring Cam — modern body cams record at higher bitrate |
| Audio | 128k AAC | Higher bitrate for close-mic audio |

### Body Camera Shake Injection

Applied only when Gate 1 detects that Veo produced a too-smooth (gimbal-like) body cam clip (avg motion < 1.5px/frame).

```bash
ffmpeg -i smooth_clip.mp4 \
  -vf "rotate='0.005*sin(2*PI*t*1.8)':fillcolor=none, \
       crop=iw-20:ih-20:10+5*sin(2*PI*t*0.7):10+3*sin(2*PI*t*1.1)" \
  -c:a copy body_cam_shaken.mp4
```

**Parameters explained:**
- `rotate='0.005*sin(2*PI*t*1.8)'` — rotation oscillates at 1.8 Hz, which is natural walking cadence (roughly 108 steps/minute)
- `crop=iw-20:ih-20` — crop 10px from each edge to hide rotation artifacts
- `10+5*sin(2*PI*t*0.7)` — X offset oscillates at 0.7 Hz (slower lateral sway)
- `10+3*sin(2*PI*t*1.1)` — Y offset oscillates at 1.1 Hz (vertical bounce)

The combination of three different frequencies creates a complex, organic shake pattern that does not look mechanical or repetitive.

### Night Mode Processing

For IR grayscale (Ring Cam night) and green-tinted NV (Body Cam night), additional post-processing is applied after the base degradation:

**Ring Cam IR:**
```bash
# Convert to grayscale, boost contrast in center (IR illuminator falloff)
-vf "hue=s=0, curves=master='0/0 0.4/0.3 0.7/0.75 1/1'"
```

**Body Cam Night Vision:**
```bash
# Green tint + grain boost for NV sensor simulation
-vf "colorbalance=gs=0.3:gm=0.3:gh=0.3, noise=alls=20:allf=t"
```

---

## 8. UI Overlay System

### Design Philosophy

Overlays are pre-built transparent PNG templates, not generated at runtime. This guarantees:
- Pixel-perfect consistency across every video
- No per-video variation or rendering bugs
- Fast compositing (single FFmpeg pass)
- Easy A/B testing of overlay styles

Dynamic elements (timestamp, unit ID, GPS coords, speed readout) are rendered by FFmpeg `drawtext` on top of the static PNG template.

### Asset Directory Structure

```
/assets/
├── overlays/
│   ├── ring_cam/
│   │   ├── template_homecam.png       # Full-frame transparent PNG, HomeCam brand
│   │   ├── template_doorview.png      # Alternate brand variant
│   │   ├── template_porchguard.png    # Alternate brand variant
│   │   ├── font_ocr_b.ttf            # OCR-B monospace (authentic security cam font)
│   │   └── recording_dot.gif          # Animated pulsing red recording indicator
│   ├── body_cam/
│   │   ├── template_unit_cam.png      # Police/security overlay
│   │   ├── template_trail_cam.png     # Hiker overlay (minimal UI)
│   │   ├── template_dashcam.png       # Dashcam overlay (speed readout position)
│   │   ├── template_helmet.png        # Helmet cam overlay
│   │   └── font_lcd_mono.ttf         # LCD monospace (body cam timestamp font)
│   └── validation/
│       ├── reference_ring_real.jpg    # Screenshot of real Ring camera (visual QA reference)
│       ├── reference_bodycam_real.jpg # Screenshot of real body cam (visual QA reference)
│       └── overlay_test.sh           # Renders overlay on test frame for developer QA
└── audio_beds/
    ├── ring_cam/
    │   ├── day_suburban_ambient.wav   # Birds, distant traffic, wind
    │   ├── night_crickets_quiet.wav   # Crickets, silence, occasional distant dog
    │   ├── night_ir_electronic_hum.wav # Faint camera hum, deep silence
    │   └── weather_rain_porch.wav     # Rain on roof, dripping, thunder
    ├── body_cam/
    │   ├── police_patrol_walking.wav  # Footsteps on pavement, radio static, breathing
    │   ├── police_patrol_radio.wav    # Dispatch chatter, static, keys jingling
    │   ├── hiker_trail_day.wav        # Boots on dirt, breathing, birds, wind
    │   ├── hiker_trail_night.wav      # Footsteps, heavy breathing, twigs, silence
    │   ├── dashcam_highway.wav        # Engine, road noise, tire hum
    │   ├── dashcam_rain.wav           # Wipers, rain on windshield, engine
    │   ├── helmet_wind.wav            # Strong wind on mic, muffled voice
    │   └── helmet_construction.wav    # Machine noise, radio, wind
    └── transitions/
        ├── motion_detected_beep.wav   # Ring Cam motion trigger alert tone
        └── radio_click.wav            # Body Cam radio activation click
```

### Ring Cam Overlay Specification

| Element | Position | Style | Notes |
|---|---|---|---|
| Timestamp | Top-left, 20px from edges | White monospace OCR-B, 16px, 85% opacity | Format: MM/DD/YYYY HH:MM:SS AM/PM |
| Camera name | Below timestamp, top-left | White OCR-B, 13px, 70% opacity | e.g., "Front Door", "Driveway", "Back Porch" |
| Recording dot | Top-right corner | Pulsing red dot, animated GIF | Simulates real camera REC indicator |
| MOTION DETECTED | Center-top flash | White text on dark band, shown at clip start for 2s | Simulates motion trigger alert |
| Brand watermark | Bottom-right | "HomeCam" or "DoorView", 9px, 50% opacity | Generic fictional brand name |

### Body Cam Overlay Specification

| Element | Position | Style | Sub-types |
|---|---|---|---|
| Timestamp | Top-left | White LCD mono, 14px, 85% opacity | Format: YYYY-MM-DD HH:MM:SS (military time) — all sub-types |
| Unit ID | Below timestamp | "UNIT 247" or "CAM-03", 12px, 80% opacity | All sub-types |
| REC indicator | Top-right | Red "REC" + blinking dot | All sub-types |
| GPS coordinates | Bottom-left | "N 37.4219° W 122.0840°", 10px, 70% opacity | Police/security ONLY |
| Speed readout | Bottom-right | "47 MPH", 14px, 80% opacity | Dashcam ONLY |

### FFmpeg Compositing Command

**Ring Cam full compositing command:**

```bash
ffmpeg -i ring_cam_degraded.mp4 -i assets/overlays/ring_cam/template_homecam.png \
  -filter_complex " \
    [0:v][1:v]overlay=0:0:format=auto[overlaid]; \
    [overlaid]drawtext=text='%{pts\:localtime\:1740000000\:%m/%d/%Y %I\\\:%M\\\:%S %p}': \
      x=20:y=18:fontsize=16:fontcolor=white@0.85: \
      fontfile=assets/overlays/ring_cam/font_ocr_b.ttf, \
    drawtext=text='Front Door': \
      x=20:y=38:fontsize=13:fontcolor=white@0.7: \
      fontfile=assets/overlays/ring_cam/font_ocr_b.ttf, \
    drawtext=text='MOTION DETECTED': \
      x=(w-tw)/2:y=15: \
      fontsize=18:fontcolor=white@0.9:fontfile=assets/overlays/ring_cam/font_ocr_b.ttf: \
      enable='lt(t,2)'" \
  -c:a copy ring_cam_overlaid.mp4
```

**Body Cam police/security compositing command:**

```bash
ffmpeg -i body_cam_degraded.mp4 -i assets/overlays/body_cam/template_unit_cam.png \
  -filter_complex " \
    [0:v][1:v]overlay=0:0:format=auto[overlaid]; \
    [overlaid]drawtext=text='%{pts\:localtime\:1740000000\:%Y-%m-%d %H\\\:%M\\\:%S}': \
      x=20:y=18:fontsize=14:fontcolor=white@0.85: \
      fontfile=assets/overlays/body_cam/font_lcd_mono.ttf, \
    drawtext=text='UNIT 247': \
      x=20:y=36:fontsize=12:fontcolor=white@0.8: \
      fontfile=assets/overlays/body_cam/font_lcd_mono.ttf, \
    drawtext=text='N 37.4219° W 122.0840°': \
      x=15:y=h-th-15:fontsize=10:fontcolor=white@0.7: \
      fontfile=assets/overlays/body_cam/font_lcd_mono.ttf" \
  -c:a copy body_cam_overlaid.mp4
```

**Opacity note:** The PNG template composites at 85% opacity on video (`overlay` filter uses alpha channel from PNG). Dynamic `drawtext` elements are set at their own opacity level per element. The result is a layered overlay where static UI chrome comes from the PNG and dynamic text from drawtext.

### Disclosure Watermark Burn

Applied as the final FFmpeg step, AFTER the UI overlay compositing (Gate 7):

```bash
ffmpeg -i body_cam_overlaid.mp4 \
  -vf "drawtext=text='AI GENERATED': \
    x=w-tw-15:y=h-th-15:fontsize=11:fontcolor=white@0.4: \
    fontfile=assets/overlays/ring_cam/font_ocr_b.ttf" \
  -c:a copy final_output.mp4
```

The "AI GENERATED" text overlaps the brand watermark zone deliberately — it will be visible even if the UI overlay is cropped or the brand watermark removed. It is rendered at 40% opacity: visible if inspected, non-distracting during normal viewing, and it travels with the video file permanently regardless of re-upload or screen recording.

---

## 9. Anti-Repetition and Content Freshness

### 30-Day Semantic Deduplication

**File:** `src/ai/dedup.ts` (called from ideator runs)

Standard keyword deduplication would flag "bear on porch" as different from "raccoon on porch" even though they are the same category/scenario. Claude-powered semantic dedup evaluates actual concept similarity:

```typescript
// Claude prompt for dedup check
`Is this new video concept too similar to any of the recent concepts?

NEW CONCEPT: "${newIdea.title}" — ${newIdea.scenario}

RECENT CONCEPTS (last 30 days):
${allRecent.map((r, i) => `${i+1}. "${r.title}" [${r.category}] — ${r.scenario}`).join('\n')}

Respond with JSON: {
  "is_duplicate": boolean,
  "similar_to": null | number,
  "similarity": "none|low|medium|high",
  "reason": "brief explanation"
}`
```

- similarity "high" → reject idea, log reason, Ideator generates replacement
- similarity "medium" → flag in `ring_cam_ideas.status = 'near_duplicate'`, skip for now
- similarity "low" or "none" → pass

### Cross-Format Dedup

The dedup check queries BOTH tables. A "deer eating from garden" Ring Cam concept and a "deer encounter on trail" Body Cam concept are semantically similar (same animal, same surprise element) even though they use different camera formats. Cross-format dedup prevents the channel from feeling repetitive when both tables are running simultaneously.

```typescript
// Both tables queried in parallel for the dedup check
const [recentRingCam, recentBodyCam] = await Promise.all([
  supabase.from('ring_cam_ideas').select('title, scenario, category')
    .gte('created_at', thirtyDaysAgo()),
  supabase.from('body_cam_ideas').select('title, scenario, category')
    .gte('created_at', thirtyDaysAgo()),
]);
const allRecent = [...recentRingCam.data, ...recentBodyCam.data];
```

### Category Rotation Weighting

**File:** `src/pipeline/category-rotation.ts`

Fourteen categories total (7 Ring Cam + 7 Body Cam) ensure variety within each format:

**Ring Cam categories:** animals, paranormal, delivery drivers, weather, wholesome, fails & comedy, night shift

**Body Cam categories:** encounter, pursuit, discovery, weather/nature, night ops, response, dashcam chaos

Category weights are computed from the last 14 days of produced ideas and passed as context to each Ideator run:

```typescript
function getCategoryWeights(format: 'ring_cam' | 'body_cam', recentIdeas: Idea[]): Record<string, number> {
  const categories = CATEGORIES[format];
  const counts: Record<string, number> = {};
  categories.forEach(c => counts[c] = 0);
  recentIdeas.forEach(idea => {
    counts[idea.category] = (counts[idea.category] || 0) + 1;
  });
  const maxCount = Math.max(...Object.values(counts), 1);
  const weights: Record<string, number> = {};
  categories.forEach(c => {
    weights[c] = (maxCount - counts[c] + 1) / (maxCount + 1);
  });
  return weights;
}
```

Inverse weighting: a category used 0 times gets weight ~1.0; a category used `maxCount` times gets weight ~0.5/maxCount. The Ideator receives the weights as context: "Generate more concepts in these underrepresented categories: [weather: 0.9, wholesome: 0.8]. Fewer in: [animals: 0.2]."

### Analytics Agent (Weekly)

**File:** `src/pipeline/analytics-agent.ts`
**Trigger:** Weekly (Sundays at 9:00 AM), scheduled via Windows Task Scheduler

The Analytics Agent queries the `analytics` table for the previous 7 days, groups by format, category, and time_of_day, and calculates:
- Average views per category per format
- Completion rate by category
- Share rate by category
- Cross-format comparison (which categories perform better in Ring Cam vs Body Cam)

It then generates category weight adjustments fed back to both Ideators on their next run:

```typescript
// Output shape from Analytics Agent
{
  ring_cam: {
    boost: ['paranormal', 'night_shift'],  // underperforming, try different approaches
    reduce: ['delivery_drivers'],           // saturated, audience fatigued
  },
  body_cam: {
    boost: ['discovery', 'weather_nature'],
    reduce: ['pursuit'],
  },
  format_recommendation: 'body_cam_trending_higher',
  schedule_suggestion: 'increase_body_cam_ratio',
}
```

---

## 10. Platform Distribution and Resilience

### Target Audience Distribution

```
YouTube (long-form):    30% of audience
YouTube Shorts:         20% of audience
TikTok:                 25% of audience
Instagram Reels:        15% of audience
Owned channels:         10% of audience ← survival layer
  ├── Email newsletter (Substack/Beehiiv)
  ├── Website with embedded videos
  └── Discord community
```

No single platform >30% exposure. If any platform suppresses reach, the channel survives.

### Blotato API Integration

**File:** `src/platforms/blotato.ts`

Blotato serves as the primary multi-platform publisher. A single API call schedules posts across all four platforms simultaneously.

```typescript
interface BlotatoPostPayload {
  videoUrl: string;          // Cloudinary CDN URL
  platforms: Platform[];
  caption: string;
  isAiGenerated: boolean;    // Passed to TikTok + Instagram API
  youtubeDescription: string;
  pinnedComment: string;
  scheduleAt?: string;       // ISO timestamp or immediate
}
```

**Compliance metadata auto-applied per platform:**

| Platform | Required Fields | Implementation |
|---|---|---|
| YouTube | Description disclosure, tags | First line of description = disclosure text |
| YouTube Shorts | Same as YouTube | Vertical 9:16 variant, same metadata |
| TikTok | `isAiGenerated: true` in API | Blotato passes through to TikTok AIGC field |
| Instagram Reels | AI-generated label | Blotato passes `isAiGenerated` to Graph API |

### Platform Posting Rate Limits

Enforced by `src/platforms/posting-guardrails.ts` before every Blotato call:

```typescript
const PLATFORM_LIMITS = {
  youtube:   { maxPerDay: 2, minHoursBetween: 4, maxPerWeek: 10 },
  shorts:    { maxPerDay: 2, minHoursBetween: 4, maxPerWeek: 10 },
  tiktok:    { maxPerDay: 3, minHoursBetween: 3, maxPerWeek: 15 },
  instagram: { maxPerDay: 2, minHoursBetween: 4, maxPerWeek: 10 },
};
```

These limits are deliberately conservative — well below each platform's technical maximum — to avoid triggering spam-detection systems.

### Suppression Detection

**File:** `src/monitoring/suppression-detector.ts`
**Trigger:** Daily, after Analytics Agent pull

```typescript
function detectSuppression(platform: Platform, recentVideos: Video[], historicalAvg: number) {
  const recentAvg = recentVideos.reduce((sum, v) => sum + v.views, 0) / recentVideos.length;
  const ratio = recentAvg / historicalAvg;

  if (ratio < 0.3) {
    return {
      alert: 'CRITICAL',
      message: `${platform} views dropped ${((1-ratio)*100).toFixed(0)}% vs 30-day avg`,
      action: 'Reduce posting 50% on this platform. Increase on others.',
    };
  }
  if (ratio < 0.6) {
    return { alert: 'WARNING', action: 'Monitor for 3 more days.' };
  }
  return { alert: 'NORMAL' };
}
```

**Automatic response to CRITICAL suppression:**
1. Reduce posting frequency on suppressed platform by 50%
2. Increase daily output on platforms with normal reach
3. Telegram alert with recommended manual actions
4. Trigger Analytics Agent to identify which content categories are most affected

### Backup Account Strategy

- One backup account per platform: YouTube, YouTube Shorts, TikTok, Instagram
- Backup accounts are warmed up with 2–4 weeks of manually posted content before pipeline launch
- Backup accounts are NEVER used for automated posting — reserved for failover only
- If primary account suspended: appeal immediately + shift to backup within 24 hours
- Backup account naming: same brand, slightly different handle (e.g., `@caughtoncamera_v2`)

### Blotato Fallback

**File:** `src/platforms/publish-fallback.ts`

If Blotato returns 503 or 429:
1. Exponential backoff retry: 5 min → 10 min → 20 min (max 3 attempts)
2. If all retries fail: insert row into `manual_publish_queue` table with Cloudinary URL
3. Telegram message to operator: "Blotato down. Manual upload needed: [URL]"
4. Operator copies Cloudinary URL into platform native upload interface (~5 min/video)

```typescript
await supabase.from('manual_publish_queue').insert({
  video_id: video.id,
  platform,
  cloudinary_url: video.master_16x9_url,
  status: 'pending_manual',
  created_at: new Date().toISOString(),
});
```

---

## 11. Database Schema

All tables live in Supabase (hosted PostgreSQL). SQLite local fallback at `/tmp/caught_on_camera/fallback.db` for Supabase outages.

### Migration 001 — Core Pipeline Tables

```sql
-- videos: one row per final video ready for distribution
CREATE TABLE videos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id      UUID NOT NULL,
  idea_source  TEXT NOT NULL CHECK (idea_source IN ('ring_cam_ideas', 'body_cam_ideas')),
  compilation_id UUID REFERENCES compilations(id),
  format       TEXT NOT NULL CHECK (format IN ('ring_cam', 'body_cam')),
  master_16x9_url TEXT,
  vertical_9x16_url TEXT,
  title        TEXT NOT NULL,
  caption      TEXT,
  duration     INTEGER,  -- seconds
  approval_status TEXT DEFAULT 'pending_review'
                   CHECK (approval_status IN ('pending_review','approved','rejected','published')),
  youtube_post_id  TEXT,
  shorts_post_id   TEXT,
  tiktok_post_id   TEXT,
  instagram_post_id TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- scenes: per-clip assets and gate results
CREATE TABLE scenes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id     UUID REFERENCES scripts(id),
  format        TEXT NOT NULL CHECK (format IN ('ring_cam', 'body_cam')),
  cam_sub_type  TEXT,  -- null for ring_cam; police_security|hiker_trail|dashcam|helmet for body_cam
  raw_video_url TEXT,
  overlaid_video_url TEXT,
  generation_cost DECIMAL(6,4),
  quality_score   INTEGER,
  gate_results    JSONB,  -- flexible storage for all 7 gate pass/fail + metadata
  crop_safe       BOOLEAN DEFAULT TRUE,
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','approved','rejected','failed')),
  retry_count     INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- scripts: Veo prompts generated by Producer Agent
CREATE TABLE scripts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id           UUID NOT NULL,
  idea_source       TEXT NOT NULL,
  camera_spec_block TEXT NOT NULL,
  environment_block TEXT,
  action_block      TEXT NOT NULL,
  audio_block       TEXT,
  full_prompt       TEXT NOT NULL,
  sanitized_prompt  TEXT,  -- post-Gate4A rewrite if any rewrites applied
  overlay_type      TEXT NOT NULL,
  overlay_config    JSONB NOT NULL,  -- sub-type, camera_name, unit_id, gps, speed fields
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- compilations: grouped clips for compilation videos
CREATE TABLE compilations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme            TEXT NOT NULL,
  title            TEXT NOT NULL,
  format           TEXT NOT NULL,
  clip_order       UUID[] NOT NULL,  -- ordered array of scene IDs
  transition_style TEXT DEFAULT 'cut',
  status           TEXT DEFAULT 'pending',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
```

**Key design decision:** `gate_results` is JSONB on `scenes`, not a separate normalized table. Gate data is append-only per scene, has variable structure per gate (Gate 1 stores motion vectors, Gate 4 stores Claude flags, Gate 2 stores face detection counts), and is read as a unit for diagnostics. JSONB is the correct fit.

### Migration 002 — Ideas Tables

**Key design decision:** Separate tables for Ring Cam and Body Cam ideas (not a single `ideas` table with a `format` column). The schemas genuinely differ — Body Cam needs `cam_sub_type` and `movement_notes`; Ring Cam needs `camera_position`. A shared table would require nullable columns or EAV pattern. Separate tables allow each to evolve independently as format requirements change.

```sql
-- ring_cam_ideas: concepts generated by Ring Camera Ideator Agent
CREATE TABLE ring_cam_ideas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  hook              TEXT NOT NULL,     -- the first 2 seconds
  scenario          TEXT NOT NULL,     -- 3-5 sentence description
  category          TEXT NOT NULL
    CHECK (category IN ('animals','paranormal','delivery_drivers','weather',
                        'wholesome','fails_comedy','night_shift')),
  camera_position   TEXT NOT NULL,     -- doorbell/porch_overhead/driveway
  time_of_day       TEXT NOT NULL,
  audio_notes       TEXT,
  virality_score    INTEGER CHECK (virality_score BETWEEN 1 AND 10),
  virality_elements TEXT[],           -- which of the 5 virality criteria hit
  format_type       TEXT DEFAULT 'single' CHECK (format_type IN ('single','compilation')),
  compilation_theme TEXT,
  caption           TEXT,
  hashtags          TEXT[],
  status            TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','in_production','produced','near_duplicate','disabled')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- body_cam_ideas: concepts generated by Body Camera Ideator Agent
CREATE TABLE body_cam_ideas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  hook              TEXT NOT NULL,     -- the first 3 seconds (longer for body cam)
  scenario          TEXT NOT NULL,
  category          TEXT NOT NULL
    CHECK (category IN ('encounter','pursuit','discovery','weather_nature',
                        'night_ops','response','dashcam_chaos')),
  cam_sub_type      TEXT NOT NULL
    CHECK (cam_sub_type IN ('police_security','hiker_trail','dashcam','helmet_action')),
  movement_notes    TEXT NOT NULL,    -- walking bob, running shake, head turns etc
  time_of_day       TEXT NOT NULL,
  audio_notes       TEXT,
  virality_score    INTEGER CHECK (virality_score BETWEEN 1 AND 10),
  virality_elements TEXT[],           -- adrenaline/mystery/awe/immersion/debate
  format_type       TEXT DEFAULT 'single' CHECK (format_type IN ('single','compilation')),
  compilation_theme TEXT,
  caption           TEXT,
  hashtags          TEXT[],
  status            TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','in_production','produced','near_duplicate','disabled')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ring_cam_ideas_status_score ON ring_cam_ideas(status, virality_score DESC);
CREATE INDEX idx_body_cam_ideas_status_score ON body_cam_ideas(status, virality_score DESC);
CREATE INDEX idx_body_cam_ideas_sub_type ON body_cam_ideas(cam_sub_type, status);
```

### Migration 003 — Cost Tracking

```sql
-- costs: per-video cost breakdown
CREATE TABLE costs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        UUID REFERENCES videos(id),
  scene_id        UUID REFERENCES scenes(id),  -- null for video-level costs
  veo_cost        DECIMAL(8,4) DEFAULT 0,
  claude_cost     DECIMAL(8,4) DEFAULT 0,
  cloudinary_cost DECIMAL(8,4) DEFAULT 0,
  total_cost      DECIMAL(8,4) NOT NULL,
  veo_variant     TEXT,                         -- 'fast' or 'standard'
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- daily_spend: running daily total (one row per date, UNIQUE enforced)
CREATE TABLE daily_spend (
  spend_date  DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  total_spent DECIMAL(8,2) DEFAULT 0,
  veo_spent   DECIMAL(8,2) DEFAULT 0,
  claude_spent DECIMAL(8,2) DEFAULT 0,
  video_count INTEGER DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Upsert pattern for daily_spend:
-- INSERT INTO daily_spend (spend_date, total_spent) VALUES (CURRENT_DATE, $1)
-- ON CONFLICT (spend_date) DO UPDATE SET total_spent = daily_spend.total_spent + $1
```

### Migration 004 — Compliance Tracking

```sql
-- published_videos: per-platform publish records with compliance metadata
CREATE TABLE published_videos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id          UUID REFERENCES videos(id) NOT NULL,
  platform          TEXT NOT NULL CHECK (platform IN ('youtube','shorts','tiktok','instagram')),
  post_id           TEXT,
  is_ai_generated   BOOLEAN DEFAULT TRUE,
  disclosure_text   TEXT,
  pinned_comment_id TEXT,
  published_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (video_id, platform)
);

-- content_flags: audit log for Gate 4 rewrites and flags
CREATE TABLE content_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id     UUID,
  idea_source TEXT,
  scene_id    UUID REFERENCES scenes(id),
  flag_type   TEXT NOT NULL CHECK (flag_type IN ('blocked_word','rewritten','policy_flag','severity_warning')),
  original    TEXT,
  replacement TEXT,
  severity    TEXT,
  gate_stage  TEXT CHECK (gate_stage IN ('4a_sanitizer','4b_claude')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- sensitivity_pauses: manual pause commands from Telegram /pause
CREATE TABLE sensitivity_pauses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pause_type      TEXT NOT NULL,  -- 'police_security'|'weather'|'all'
  reason          TEXT,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ends_at         TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,    -- null = still active
  activated_by    TEXT DEFAULT 'operator'
);

-- manual_publish_queue: Blotato fallback queue
CREATE TABLE manual_publish_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id      UUID REFERENCES videos(id),
  platform      TEXT NOT NULL,
  cloudinary_url TEXT NOT NULL,
  status        TEXT DEFAULT 'pending_manual',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### Migration 005 — Analytics and Platform Health

```sql
-- analytics: per-platform performance metrics (populated by Analytics Agent)
CREATE TABLE analytics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        UUID REFERENCES videos(id) NOT NULL,
  platform        TEXT NOT NULL,
  format          TEXT NOT NULL,  -- ring_cam|body_cam (denormalized for query convenience)
  category        TEXT,
  views           INTEGER DEFAULT 0,
  likes           INTEGER DEFAULT 0,
  shares          INTEGER DEFAULT 0,
  comments        INTEGER DEFAULT 0,
  completion_rate DECIMAL(5,2),  -- 0-100 percent
  posted_at       TIMESTAMPTZ,
  fetched_at      TIMESTAMPTZ DEFAULT NOW()
);

-- platform_health: suppression detection data
CREATE TABLE platform_health (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        TEXT NOT NULL,
  check_date      DATE NOT NULL,
  recent_7d_avg   DECIMAL(10,2),
  historical_30d_avg DECIMAL(10,2),
  ratio           DECIMAL(5,3),   -- recent/historical
  alert_level     TEXT CHECK (alert_level IN ('normal','warning','critical')),
  action_taken    TEXT,
  UNIQUE (platform, check_date)
);

-- CREATE VIEW for easy suppression dashboard
CREATE VIEW current_platform_health AS
SELECT DISTINCT ON (platform)
  platform, check_date, ratio, alert_level, action_taken
FROM platform_health
ORDER BY platform, check_date DESC;
```

---

## 12. Budget Model

### Cost Per Format

| Content Type | Veo Cost (Fast) | Claude Cost | Total Range |
|---|---|---|---|
| Ring Cam single (30s) | $3.00–4.50 | $0.15 | $3.15–4.65 |
| Body Cam single (45s) | $4.50–6.75 | $0.15 | $4.65–6.90 |
| Compilation (5 clips, Fast) | $15.00–22.00 | $0.40 | $15.40–22.40 |
| Daily target (2 singles + 1 compilation) | $22.00–33.00 | $0.70 | $22.70–33.70 |

Body Cam clips cost ~50% more than Ring Cam due to longer duration (45s vs 30s). The default strategy uses Fast Veo variant for all content. Standard quality is reserved for manually designated "hero" content.

### Monthly Cost Breakdown

| Item | Low | High |
|---|---|---|
| Veo 3.1 (Fast, ~100 clips/month) | $680 | $1,010 |
| Claude API (4 agents) | $25 | $50 |
| Blotato Starter | $29 | $29 |
| Cloudinary (free tier baseline, upgrade if needed) | $0 | $10 |
| Supabase (free tier) | $0 | $0 |
| Legal review (amortized from one-time $500–1,000) | $42 | $84 |
| **TOTAL** | **$776** | **$1,183** |

### Budget Control Architecture

**File:** `src/db/costs.ts`

```typescript
const DAILY_BUDGET = {
  hard_cap: 50,     // USD — abort generation, no exceptions
  warning_at: 40,   // USD — Telegram warning alert
  target: 25,       // USD — normal daily operating range
};
```

**Enforcement sequence (every pipeline run):**

1. `checkBudget()` runs BEFORE every Veo API call — not just at pipeline start
2. If `daily_spend.total_spent >= hard_cap`: return `{ canGenerate: false }`, ABORT with Telegram alert
3. If `daily_spend.total_spent >= warning_at`: send Telegram warning, continue
4. After every Veo generation: upsert `daily_spend`, check again

**Retry budget:**

The $25 target leaves $25 remaining buffer for retries, Gate 1 regenerations (max 3 per clip), and opportunistic compilation generation when previous singles passed at low cost.

**Compilation gating:**

Compilation generation (5 clips, $15–22) only proceeds if: `today_spend + estimated_compilation_cost < hard_cap`. Estimated cost must be pre-computed using clip count × clip_duration × $0.15/second before the first API call.

**Cost write pattern:**

```typescript
// After every Veo call, regardless of gate results:
await supabase.from('costs').insert({
  video_id, scene_id,
  veo_cost: veoCost,
  claude_cost: claudeCost,
  total_cost: veoCost + claudeCost,
  veo_variant: 'fast',
});
// Upsert into daily_spend atomically:
await supabase.rpc('increment_daily_spend', { amount: veoCost + claudeCost });
```

---

## 13. Ethics Framework

### Why Police Body Cam Content Is The Highest Risk

Real body cam footage has documented police violence against civilians. Creating fictional AI body cam content that resembles this footage — even with disclosures — could:
- Trivialize real documented harm
- Be mistaken for real incidents despite disclosures
- Contribute to erosion of trust in video evidence
- Expose the channel to legal liability in some jurisdictions

The ethical framework for this specific risk is built in three independent layers, plus a kill switch that operates in under 30 seconds.

### Layer 1: Ideator Prompt Hardcoding (Prevention)

The Body Cam Ideator system prompt contains explicit, non-negotiable absolute prohibitions for the police/security sub-type:

```
ABSOLUTE PROHIBITIONS FOR POLICE/SECURITY SUB-TYPE:
- NEVER depict arrest, detention, or restraint of any person
- NEVER depict use of force (physical, taser, spray, weapon)
- NEVER depict traffic stops
- NEVER depict confrontation between the wearer and any civilian
- NEVER depict pursuit of a person (pursuit of animals is OK)
- NEVER depict commands being given to a civilian
- NEVER reference real police departments, cities, or jurisdictions
- NEVER depict scenarios that resemble any real incident of police violence

PERMITTED POLICE/SECURITY SCENARIOS ONLY:
- Night patrol with unexplained phenomena (lights, sounds, shadows)
- Animal encounter on patrol
- Welfare check on empty/abandoned property with mystery element
- Weather event encountered on patrol
- Positive community interaction (helping lost dog, etc.)
```

Overlay identifiers use only fictional generic designations: "UNIT 247", "SECURITY PATROL", "WESTFIELD COMMUNITY PATROL" — verified against USPTO TESS to not conflict with real agencies before launch.

### Layer 2: Gate 4A Prompt Sanitizer (Detection)

The blocked words list includes police-action-specific terms:

```typescript
const POLICE_BLOCKED_WORDS = [
  'arrest', 'handcuff', 'taser', 'pepper spray', 'use of force',
  'traffic stop', 'pull over', 'suspect', 'perpetrator', 'criminal',
  'get on the ground', 'hands up', 'don\'t move', 'under arrest',
];
```

Any prompt containing these terms is rejected before Veo is called. Zero cost, instant rejection.

### Layer 3: Gate 4B Claude Content Review (Verification)

After Veo generates the clip, 5 keyframes are reviewed by Claude specifically checking: "Does this content resemble a real law enforcement incident? Is there any depiction that could be interpreted as use of force, civilian confrontation, or arrest?" Severity "high" or "critical" = HARD FAIL + log to `content_flags`.

### Kill Switch

```typescript
// src/utils/kill-switch.ts
const ACTIVE_SUB_TYPES = {
  police_security: process.env.ENABLE_POLICE_SUBTYPE === 'true',
  hiker_trail:     true,
  dashcam:         true,
  helmet_action:   true,
};
```

**Telegram command:** `/disable police`
- Sets `ENABLE_POLICE_SUBTYPE=false` in runtime config
- All queued `body_cam_ideas` with `cam_sub_type='police_security'` moved to `status='disabled'`
- No new police-type ideas generated until operator explicitly re-enables
- Re-enable requires: `/enable police` + 14-day waiting period check

### Permanent Retirement Triggers

If any of the following occur, the police sub-type is **permanently retired** (remove entirely from Ideator, set all queued ideas to `status='disabled'`, remove template from Producer):

1. Pre-launch attorney review advises against it for operator's jurisdiction
2. Any police-subtype video goes viral as "real police footage" despite all disclosures
3. Community feedback indicates content is perceived as harmful or insensitive
4. Any platform issues a strike specifically citing the police body cam sub-type
5. Operator judgment call — no trigger required

### Sensitivity Calendar

**File:** `src/monitoring/sensitivity-calendar.ts`

Manual pause system, activated via Telegram commands:

| Telegram Command | Effect | Duration |
|---|---|---|
| `/pause police` | Pause police/security sub-type | 14 days minimum |
| `/pause weather` | Pause weather/disaster content | 7 days minimum |
| `/pause all` | Pause all content generation | Operator-specified |
| `/resume` | End earliest active pause (if past minimum) | Immediate |

Pause records stored in `sensitivity_pauses` table. `checkBuffer()` and `ideator.ts` both query active pauses before generating or selecting ideas.

### Trust Preservation

Auto-responses to "is this real?" comments via Blotato comment API, rotating through:

```typescript
const AUTO_RESPONSES = [
  "Great question! This is AI-generated content made with Veo 3.1. No real events depicted! 🤖",
  "Nope, all AI-generated! We use AI to create 'what if' security camera scenarios for entertainment. Check our bio!",
  "100% AI-generated! Glad it looks convincing though 😄 No real people or events.",
];
```

Trigger phrases monitored: "is this real", "this is real", "actual footage", "did this really happen", "where did this happen"

---

## 14. Security and Compliance

### Secret Management

- All credentials in `.env` only — never in source files or committed to git
- `.env` excluded by `.gitignore` (verified at project setup)
- `src/config.ts` uses Zod to validate presence of all required vars at startup; values are never logged
- Supabase service key (never anon key) used for all database operations
- FAL_KEY, ANTHROPIC_API_KEY stored as environment variables in WSL2 only

### 4-Layer AI Disclosure System

Every published video carries four independent, redundant disclosures:

| Layer | Where | What | Permanent? |
|---|---|---|---|
| 1 | Video file itself | "AI GENERATED" burned in (Gate 7) | Yes — survives re-upload |
| 2 | Platform metadata | `isAiGenerated: true` API field | Platform-dependent |
| 3 | Description/caption | "AI-generated, not real footage" in first line | Yes |
| 4 | Pinned comment | Explicit AI disclosure + entertainment framing | Until deleted |

No viewer can reasonably claim they were not informed the content is AI-generated.

### Synthetic Media Law Compliance

**Jurisdictions reviewed at launch:**

| Jurisdiction | Law/Regulation | Requirement | Implementation |
|---|---|---|---|
| California | AB 602, AB 2655 | Disclose AI-generated realistic depictions | Gate 7 watermark + description |
| Texas | SB 751 | AI disclosure for synthetic media | Platform metadata + description |
| New York | Pending legislation | Disclosure requirements | Proactive over-disclosure |
| EU | AI Act 2024 | "Deep fake" disclosure requirements | Video watermark + platform flags |

**Pre-launch legal checklist (non-negotiable):**

- [ ] Media attorney review of disclosure language on all platforms ($500–1,000 one-time)
- [ ] Attorney review of police/security sub-type for impersonation risk in operator's jurisdiction
- [ ] Trademark clearance: HomeCam, DoorView, PorchGuard, WESTFIELD COMMUNITY PATROL (USPTO TESS)
- [ ] Platform policy audit matrix: read and document YouTube/TikTok/Instagram current AI content policies
- [ ] Disclosure template library: channel bio text, video description template, pinned comment template, crisis response statement
- [ ] Written attorney opinion letter on file before first publish

**Quarterly compliance cadence:**
- Re-read platform AI content policies (they update 2–4x per year)
- Update compliance matrix
- Review new state/federal synthetic media legislation
- Verify Gate 7 watermark still functioning in production
- Attorney follow-up if significant legal changes ($200–300/quarter)

### PII Policy

- No viewer data collected
- No analytics data contains personally identifiable information
- Anonymous view counts only from platform APIs
- `content_flags` table logs prompts and flags but not viewer data
- Emergency takedown log in `sensitivity_pauses` contains only operator-generated data

### Cloudinary Storage

All published video content hosted on Cloudinary CDN. Local WSL2 storage (`/tmp/caught_on_camera/`) is scratch space only — files deleted per the retention schedule in Shield 6. No published content is hosted locally.

### Emergency Takedown

```bash
npm run emergency-takedown -- --video-id <uuid> [--reason dmca|policy|ethics]
```

Actions:
1. Delete from YouTube, TikTok, Instagram via platform APIs (via Blotato delete endpoint)
2. Delete from Cloudinary CDN
3. If `--reason dmca`: strip audio from local archived file
4. Insert record into `sensitivity_pauses` with type='takedown'
5. Send Telegram alert with video ID and reason
6. Update `videos.approval_status = 'taken_down'`

---

## 15. Deployment

### Runtime Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | >= 20.0.0 | ESM modules required |
| TypeScript | 5.x strict mode | `strict: true` in tsconfig |
| FFmpeg | Any recent | Must be in WSL2 PATH: `sudo apt install ffmpeg` |
| Python 3 | >= 3.8 | Required for Gate 2 OpenCV face detection |
| OpenCV Python | 4.x | `pip3 install opencv-python` — optional, Claude vision fallback available |
| WSL2 | Ubuntu 22.04+ | Primary runtime environment |
| Windows | 11 | Host OS for Task Scheduler |

### WSL2 Path Conventions

```
Inside Node.js / FFmpeg (WSL2 paths):
  /tmp/caught_on_camera/                  Scratch space root
  /tmp/caught_on_camera/scenes/{id}/      Per-scene working directory
  /tmp/caught_on_camera/videos/{id}/      Per-video assembly directory
  /tmp/caught_on_camera/fallback.db       SQLite fallback database
  /tmp/caught_on_camera/logs/             Pipeline logs

Project root (accessible from both sides):
  Windows:  C:\Users\lmand\AppData\Local\Temp\mandras_made_skills\caught_on_camera\
  WSL2:     /mnt/c/Users/lmand/AppData/Local/Temp/mandras_made_skills/caught_on_camera/

Write tool (Claude Code skill):
  Uses Windows path — C:/Users/lmand/...
  DO NOT use /tmp/ paths with Write tool (different filesystem from Bash tool)
```

### Windows Task Scheduler Configuration

**Daily pipeline run (8:00 AM):**
```
Task Name:  CaughtOnCamera-Daily
Program:    wsl.exe
Arguments:  -d Ubuntu -e bash -c
            "cd /mnt/c/Users/lmand/AppData/Local/Temp/mandras_made_skills/caught_on_camera &&
             npm run pipeline >> /tmp/caught_on_camera/logs/daily.log 2>&1"
Trigger:    Daily at 08:00
```

**Ideator run (Monday/Wednesday/Friday, 6:00 AM — before daily pipeline):**
```
Task Name:  CaughtOnCamera-Ideator
Program:    wsl.exe
Arguments:  -d Ubuntu -e bash -c
            "cd /mnt/c/Users/lmand/AppData/Local/Temp/mandras_made_skills/caught_on_camera &&
             npm run ideator >> /tmp/caught_on_camera/logs/ideator.log 2>&1"
Trigger:    Weekly on Mon/Wed/Fri at 06:00
```

**Analytics Agent (Sunday, 9:00 AM):**
```
Task Name:  CaughtOnCamera-Analytics
Program:    wsl.exe
Arguments:  -d Ubuntu -e bash -c
            "cd /mnt/c/Users/lmand/AppData/Local/Temp/mandras_made_skills/caught_on_camera &&
             npm run analytics >> /tmp/caught_on_camera/logs/analytics.log 2>&1"
Trigger:    Weekly on Sunday at 09:00
```

**WSL2 cron (backup, requires WSL2 already running):**
```
0 8 * * *     cd /mnt/c/.../caught_on_camera && npm run pipeline
0 6 * * 1,3,5 cd /mnt/c/.../caught_on_camera && npm run ideator
0 9 * * 0     cd /mnt/c/.../caught_on_camera && npm run analytics
```

### npm Scripts Reference

| Script | Command | Purpose |
|---|---|---|
| `pipeline` | `npm run pipeline` | Full daily production run |
| `ideator` | `npm run ideator` | Both ideators (Ring Cam + Body Cam) |
| `ideator:ring` | `npm run ideator:ring` | Ring Cam Ideator only |
| `ideator:body` | `npm run ideator:body` | Body Cam Ideator only |
| `analytics` | `npm run analytics` | Weekly Analytics Agent |
| `check-env` | `npm run check-env` | Validate all required env vars |
| `setup-db` | `npm run setup-db` | Run SQL migrations against Supabase |
| `smoke-test` | `npm run smoke-test` | Verify all integrations are reachable |
| `emergency-takedown` | `npm run emergency-takedown` | Remove video from all platforms |
| `overlay-test` | `npm run overlay-test` | Render overlay on test frame for visual QA |

### Environment Variable Reference

**AI Providers:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | claude-sonnet-4-6 (primary AI for all agents) |
| `FAL_KEY` | Yes | — | fal.ai Veo 3.1 video generation |

**Database:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | — | Service role key (never anon key) |

**Storage:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | Yes | — | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Yes | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Yes | — | Cloudinary API secret |

**Monitoring:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram Bot API token |
| `TELEGRAM_CHAT_ID` | Yes | — | Chat/channel ID for operator alerts |

**Publishing:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `BLOTATO_API_KEY` | Yes | — | Blotato multi-platform publishing API |
| `BLOTATO_YOUTUBE_ACCOUNT_ID` | Yes | — | YouTube account registered in Blotato |
| `BLOTATO_INSTAGRAM_ACCOUNT_ID` | Yes | — | Instagram account registered in Blotato |
| `BLOTATO_TIKTOK_ACCOUNT_ID` | Yes | — | TikTok account registered in Blotato |

**Pipeline Configuration:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `BUDGET_HARD_CAP` | No | `50` | Daily hard cap in USD — abort at this amount |
| `BUDGET_WARNING_AT` | No | `40` | Daily warning threshold in USD |
| `BUDGET_TARGET` | No | `25` | Daily production target in USD |
| `BUFFER_MAX` | No | `5` | Skip generation when approved-unpublished >= this |
| `FORMAT_SCHEDULE` | No | See Section 4.5 | JSON string of day-to-format mapping |
| `VEO_VARIANT` | No | `fast` | `fast` or `standard` |
| `ENABLE_POLICE_SUBTYPE` | No | `true` | Set to `false` to disable police/security ideas |
| `LOG_LEVEL` | No | `info` | Winston log level |
| `LOG_FORMAT` | No | `text` | `text` or `json` |
| `NODE_ENV` | No | `development` | `production` enables stricter enforcement |
| `STORAGE_LOCAL_PATH` | No | `/tmp/caught_on_camera` | WSL2 scratch space root |
| `FFMPEG_PATH` | No | (system PATH) | Override FFmpeg binary path |
| `FFPROBE_PATH` | No | (system PATH) | Override FFprobe binary path |
| `PYTHON3_PATH` | No | `python3` | Override Python 3 path for face detection |
| `SCENE_RETENTION_DAYS` | No | `7` | Days before raw scene files are deleted |
| `ARCHIVE_AFTER_DAYS` | No | `90` | Days before approved videos move to archive |

### Component Reference

**Pipeline (`src/pipeline/`):**

| Module | Purpose |
|---|---|
| `orchestrator.ts` | Main entry point: env check → budget → buffer → format select → produce → review |
| `ideator-ring.ts` | Ring Camera Ideator Agent: Claude generates 15–20 concepts, dedup, score |
| `ideator-body.ts` | Body Camera Ideator Agent: Claude generates 15–20 concepts, dedup, score |
| `producer.ts` | Producer Agent: selects prompt template, generates Veo prompt, Gate 4A |
| `publisher.ts` | Blotato API publish with compliance metadata, fallback to manual queue |
| `analytics-agent.ts` | Weekly Analytics Agent: performance review, category weight adjustments |

**Gates (`src/gates/`):**

| Gate | File | Check | Fail Type |
|---|---|---|---|
| 1 | `gate1-motion.ts` | Optical flow motion analysis | Ring: hard reject; Body: add shake |
| 2 | `gate2-face.ts` | OpenCV face detection + blur | Always passes (auto-blur) |
| 3 | `gate3-audio.ts` | Volume level + format range | Soft (audio bed fallback) |
| 4 | `gate4-policy.ts` | Prompt sanitizer + Claude keyframe review | Hard fail |
| 5 | `gate5-crop.ts` | 9:16 crop safety analysis | Graceful degrade (16:9 only) |
| 6 | `gate6-overlay.ts` | FFmpeg compositing + Claude visual QA | Soft (retry once) |
| 7 | `gate7-disclosure.ts` | Watermark presence verification | Hard fail |
| — | `index.ts` | Gate runner: orchestrates 1–7, enforces hard-fail semantics | — |

**AI Clients (`src/ai/`):**

| Module | Purpose |
|---|---|
| `claude.ts` | Text + vision via Anthropic claude-sonnet-4-6 |
| `veo.ts` | Video generation via fal.ai Veo 3.1, with retry logic |
| `dedup.ts` | 30-day semantic deduplication via Claude |
| `prompt-sanitizer.ts` | Gate 4A keyword screening and rewrite |

**Database (`src/db/`):**

| Module | Purpose |
|---|---|
| `client.ts` | Supabase primary, SQLite fallback, sync recovery |
| `costs.ts` | Cost writes, daily budget queries, cap enforcement |
| `ideas.ts` | ring_cam_ideas and body_cam_ideas CRUD |
| `videos.ts` | Video/scene CRUD, status management |
| `analytics.ts` | Analytics reads/writes, suppression detection queries |

**Media (`src/media/`):**

| Module | Purpose |
|---|---|
| `ffmpeg.ts` | All FFmpeg operations: degrade, overlay, compositing, watermark, multi-format |
| `frames.ts` | Frame extraction for gate vision analysis |
| `audio.ts` | Audio analysis, volume detection, audio bed mixing |

**Monitoring (`src/monitoring/`):**

| Module | Purpose |
|---|---|
| `telegram.ts` | Bot alerts: alert / info / error / reviewRequest |
| `buffer.ts` | Buffer depth check and low-buffer alerts |
| `suppression-detector.ts` | Platform suppression detection, auto-redistribute |
| `sensitivity-calendar.ts` | Pause state management, Telegram /pause /resume handlers |

**Platforms (`src/platforms/`):**

| Module | Purpose |
|---|---|
| `blotato.ts` | Primary Blotato API publisher |
| `cloudinary.ts` | Video CDN upload, URL management |
| `posting-guardrails.ts` | Per-platform rate limit enforcement |
| `publish-fallback.ts` | Blotato outage fallback to manual queue |

**Scripts (`scripts/`):**

| Script | `npm run` | Purpose |
|---|---|---|
| `check-env.ts` | `check-env` | Validate all required env vars |
| `setup-db.ts` | `setup-db` | Run SQL migrations against Supabase |
| `smoke-test.ts` | `smoke-test` | Verify all integrations reachable |
| `emergency-takedown.ts` | `emergency-takedown` | Remove video from all platforms |
| `overlay-test.ts` | `overlay-test` | Render test frame with overlay for visual QA |
| `storage-cleanup.ts` | `storage-cleanup` | Delete expired scene files, archive old videos |

---

*End of DESIGN.md — Caught on Camera AI Pipeline v1.0*
