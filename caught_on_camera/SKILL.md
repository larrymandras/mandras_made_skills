# Caught on Camera Skill

AI-generated security and body camera viral content system. Dual-format pipeline: Ring Camera (static doorbell/porch POV) and Body Camera (first-person POV with 4 sub-types). Claude orchestrates decisions; TypeScript scripts handle deterministic work (FFmpeg, API calls, DB writes).

## Commands

---

### `/caught-on-camera setup`

One-time setup. Walk through each step in order. Do not skip steps.

**Step 1 — Install Node.js dependencies**
```bash
cd ~/caught_on_camera && npm install
```

**Step 2 — Configure environment**
```bash
cp .env.example .env
# Edit .env — fill in all required keys (see env var list in Reference Tables below)
```

**Step 3 — Validate environment**
```bash
npm run check-env
```
All required vars must report `set` or `✓` before continuing. Fix any failures.

**Step 4 — Run database migrations**
```bash
npm run setup-db
```
Or via Supabase CLI (recommended if exec_sql RPC unavailable):
```bash
npx supabase db push
```
`setup-db` should report all 5 migrations applied and FORMAT_SCHEDULE seeded.

**Step 5 — Verify DB**
Open Supabase dashboard → Table Editor. Confirm these tables exist:
- `videos`, `ring_cam_ideas`, `body_cam_ideas`
- `scenes`, `scene_costs`, `daily_budget_log`
- `content_pauses`, `takedown_log`, `compliance`
- `platform_health`, `platform_publishes`, `analytics`, `config`

**Step 6 — Create overlay assets**

Overlay PNGs must be created before Phase 4. They are composited onto every video to give the security/body-cam aesthetic.

Directory structure required:
```
assets/overlays/
  ring_cam/
    standard.png          — doorbell cam frame (black border, timestamp top-left)
    night.png             — night-vision tinted variant (green tint + noise)
    motion_alert.png      — red MOTION DETECTED indicator variant
  body_cam/
    police_security/
      standard.png        — body cam HUD, badge area blurred/obscured, unit ID top-right
    hiker_trail/
      standard.png        — trail cam aesthetic, coordinates bottom-left, date/time top
    dashcam/
      standard.png        — dashcam frame, speed display bottom, rearview mirror top-right
    helmet_action/
      standard.png        — GoPro-style fisheye frame, action cam branding (fictional)
  validation/
    test_pattern.png      — simple labeled test pattern for gate 6 overlay testing
```

PNG creation guide:
- Dimensions: 1920x1080 (16:9 master). The 9:16 vertical output uses center-cropped version.
- Use RGBA (transparency for non-frame areas so underlying video shows through)
- Frame elements: thin border, timestamp region (transparent background for text burned in by FFmpeg), corner indicators
- Badge/logo areas on police_security overlay must be obscured (filled block, not a real badge)
- Fictional branding only — never reference real law enforcement agencies or real dashcam brands by name

Test overlay pipeline after creation:
```bash
ffmpeg -i tests/fixtures/videos/sample.mp4 \
  -i assets/overlays/ring_cam/standard.png \
  -filter_complex "overlay=0:0" -c:a copy /tmp/overlay_test.mp4
# Open /tmp/overlay_test.mp4 and verify frame renders correctly
```

**Step 7 — Populate audio beds**

Audio beds are mixed at -18dB under generated video audio for ambient texture.

Required files (minimum 8):
```
assets/audio_beds/
  ring_cam/
    ambient_night.wav     — quiet suburban night, crickets, distant traffic
    suburban_day.wav      — mild neighborhood ambience, birds, occasional car
    rainy_evening.wav     — rain on surfaces, thunder-optional
    tense_drone.wav       — low ambient tension (paranormal content)
  body_cam/
    police_radio.wav      — radio squelch crackle bed (no intelligible speech)
    forest_ambience.wav   — wind, leaves, wildlife (trail sub-type)
    road_traffic.wav      — moving vehicle interior, engine, road noise (dashcam)
    action_percussion.wav — rhythmic low-intensity beat for action/sport content
```

Where to source audio beds:
- Freesound.org (CC0 or CC-BY license — log attribution in `/assets/audio_beds/CREDITS.txt`)
- Pixabay Music (royalty-free commercial use)
- BBC Sound Effects library (check license for AI-generated content use)
- Original recordings (preferred for unique sound design)
- Do NOT use YouTube Audio Library tracks — license unclear for AI-generated content

**Step 8 — Configure Telegram bot**

1. Message @BotFather on Telegram → `/newbot` → follow prompts → note `TELEGRAM_BOT_TOKEN`
2. Create a private Telegram channel or group for monitoring
3. Add your bot to the channel as admin
4. Get `TELEGRAM_CHAT_ID`: send a message in the channel, then visit:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   Find `chat.id` in the response
5. Set both in `.env`: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

**Step 9 — Authenticate platforms via Blotato**

Blotato handles multi-platform authentication and publishing. Connect accounts at https://blotato.com/settings:
1. Connect YouTube channel → copy the account ID → `BLOTATO_YOUTUBE_ACCOUNT_ID`
2. Connect TikTok account → copy the account ID → `BLOTATO_TIKTOK_ACCOUNT_ID`
3. Connect Instagram professional account → copy the account ID → `BLOTATO_INSTAGRAM_ACCOUNT_ID`
4. Set `BLOTATO_API_KEY` from Blotato API settings

**Step 10 — Smoke test**
```bash
npm run smoke-test
```
All 10 tests must pass before running the pipeline. If any fail, fix them first.

Smoke test checklist:
- Test 1: Supabase connection
- Test 2: Claude API
- Test 3: fal.ai API key valid
- Test 4: Telegram bot sends test message
- Test 5: Cloudinary credentials valid
- Test 6: Blotato API key valid
- Test 7: FFmpeg installed
- Test 8: Overlay assets exist
- Test 9: Audio beds exist
- Test 10: Prompt sanitizer blocks "arrest"

---

### `/caught-on-camera run`

Execute the full pipeline for one video. Generates, gates, composites, and sends to Telegram for human review.

**Step 1 — Pre-flight checks**
```bash
npm run check-env
npm run status
```
If daily spend ≥ $50: abort — `Daily hard cap reached. No videos will be generated today.`
If buffer ≥ 3 days of approved-unpublished videos: skip generation — `Buffer healthy (N videos). Skipping generation.`

**Step 2 — Format schedule lookup**
Check `FORMAT_SCHEDULE` for today's day-of-week:
```
Monday    → ring_cam (animals)
Tuesday   → body_cam (night_patrol)
Wednesday → ring_cam (compilation)
Thursday  → body_cam (trail)
Friday    → ring_cam (paranormal)
Saturday  → body_cam (compilation)
Sunday    → operator_choice (highest virality from either format)
```
Override in DB: `UPDATE config SET value='...' WHERE key='FORMAT_SCHEDULE'`

**Step 3 — Ideator run (3x per week minimum)**
If ideas queue for today's format is low (< 10 pending):
- Ring cam: run Ring Cam Ideator → 10 new concepts with virality scoring + dedup
- Body cam: run Body Cam Ideator → 10 new concepts with sub-type selection + ethics check
- Both: prompt sanitizer (Gate 4 Stage A) runs on every concept before DB insert

**Step 4 — Select top idea**
Pull highest `virality_score` pending idea matching today's format:
```sql
SELECT * FROM ring_cam_ideas WHERE status='pending' ORDER BY virality_score DESC LIMIT 1
-- or body_cam_ideas
```
Mark idea `in_production` to prevent double-use.

**Step 5 — Gate 4 Stage A — prompt sanitizer**
Run `sanitizePrompt(idea.prompt_seed)` before Veo generation:
- Blocked words: reject idea, mark `rejected`, pick next highest-scored idea
- Rewrite words: apply rewrites, log changes, proceed with sanitized prompt

**Step 6 — Veo generation**
Call fal.ai Veo 3.1 with format-appropriate prompt template:
- Ring cam: static camera POV, residential outdoor setting, camera artifacts
- Body cam: first-person walking POV, sub-type-appropriate aesthetic
Poll fal.ai for completion (exponential backoff, max 10-minute timeout).
Download raw clip to `TEMP_DIR/raw/<video_id>.mp4`.
Record cost in `scene_costs`.

**Step 7 — AI degradation pipeline**
Apply format-specific degradation to raw clip:
- Ring cam: grain, desaturation, compression artifact
- Body cam: hand-shake (sub-type intensity), motion blur, lens effects

**Step 8 — 7-gate pipeline**
Run all gates in order via `runGatePipeline()`:

| Gate | Type | Fail Action |
|------|------|-------------|
| 1 Motion | Soft | Ring cam: regenerate; Body cam: add_shake |
| 2 Face blur | Transform | Blur detected faces, continue |
| 3 Audio | Soft | Mix audio bed or replace audio |
| 4 Policy | Hard | Abort immediately, no further gates |
| 5 Crop safe | Soft | Mark cropSafe=false, YouTube-only |
| 6 Overlay | Hard | Re-apply overlay, re-run gate |
| 7 Disclosure | Hard | Alert Telegram, abort |

**Step 9 — Overlay compositing**
Apply format overlay PNG:
- Ring cam: `assets/overlays/ring_cam/<variant>.png`
- Body cam: `assets/overlays/body_cam/<sub_type>/standard.png`
FFmpeg composite with alpha channel.

**Step 10 — Multi-format output**
Generate:
- 16:9 master: 1920x1080, H.264, 8Mbps
- 9:16 vertical: 1080x1920, center-cropped (or safe-zone crop from gate 5)

**Step 11 — Cloudinary upload**
Upload both variants:
```
caught_on_camera/<video_id>/master.mp4
caught_on_camera/<video_id>/vertical.mp4
```
Tag with: format, sub_type, category, gate_results summary.

**Step 12 — Telegram review request**
Send review message:
```
[RING CAM] New video ready for review
— or —
[BODY CAM: dashcam] New video ready for review

Title: <concept title>
Category: <category>
Virality score: <score>/100
Cost: $X.XX
Gates: all 7 passed

Preview: <cloudinary URL>

/approve <video_id>
/reject <video_id> <reason>
```
Set `videos.status = 'pending_review'`.

**Step 13 — Approve / reject (via Telegram)**
Operator sends `/approve <video_id>` or `/reject <video_id> <reason>` in Telegram channel.
Bot webhook updates DB, triggers publish on approve.

---

### `/caught-on-camera status`

Show current pipeline state.

```bash
npm run status
```

Output includes:
- Buffer: N videos approved + unpublished (X.X days)
- Daily spend: $X.XX / $50.00 (XX%) with visual bar
- Format schedule: Today → ring_cam (animals), Tomorrow → body_cam (night_patrol)
- Ideas queue: X ring_cam pending, X body_cam pending
- Platform health: YouTube NORMAL, TikTok WARNING, Instagram NORMAL
- Last video: [BODY CAM: dashcam] "Dashcam captures UFO near highway" — published 4h ago — 12,400 views
- Active pauses: none / police_security paused until 2026-03-01

---

### `/caught-on-camera review`

List all videos pending human review.
```sql
SELECT id, format, sub_type, title, virality_score, total_cost_usd, created_at
FROM videos WHERE status = 'pending_review'
ORDER BY created_at;
```
Display each with gate scores and Telegram approve/reject instructions.

---

### `/approve <video_id>`

Sent in Telegram channel. Triggers publish:
```sql
UPDATE videos SET status='approved', approved_at=NOW() WHERE id='<video_id>';
```
Then publishes via Blotato to all platforms with compliance metadata.
Posts pinned comment: "#AIGenerated — This video is AI-generated using fal.ai Veo 3.1."

---

### `/reject <video_id> <reason>`

Sent in Telegram channel. Rejects video:
```sql
UPDATE videos SET status='rejected', rejection_reason='<reason>', rejected_at=NOW()
WHERE id='<video_id>';
```
Video stored for analysis. Cloudinary assets retained for 90 days. Idea may be re-queued with adjustment notes.

---

### `/caught-on-camera pause`

Disable specific content types or pause entirely.

```bash
# Disable police_security sub-type (also controlled by ENABLE_POLICE_SUBTYPE env var)
/caught-on-camera pause police

# Pause weather content for 7 days (ring cam weather category)
/caught-on-camera pause weather

# Pause all content generation for N days
/caught-on-camera pause all 3
```

Pause commands write to `content_pauses` table. Pipeline pre-flight checks this table.

Direct DB equivalent:
```sql
-- Pause police sub-type indefinitely
INSERT INTO content_pauses (category, paused_until, paused_all)
VALUES ('police_security', NULL, false);

-- Pause all for 3 days
INSERT INTO content_pauses (category, paused_until, paused_all)
VALUES ('all', NOW() + INTERVAL '3 days', true);

-- Remove a pause
DELETE FROM content_pauses WHERE category = 'weather';
```

---

### `/caught-on-camera schedule`

View or override the format rotation schedule.

```bash
# Show current schedule
/caught-on-camera schedule

# Override Thursday to ring_cam
/caught-on-camera schedule set thursday ring_cam

# Override Sunday to body_cam dashcam
/caught-on-camera schedule set sunday body_cam/dashcam
```

Schedule is stored in the `config` table under key `FORMAT_SCHEDULE` (JSON). The `.env` var `FORMAT_SCHEDULE` overrides the DB value at runtime.

Default schedule:
| Day | Format | Category hint |
|-----|--------|---------------|
| Sunday | operator_choice | (highest virality, either format) |
| Monday | ring_cam | animals |
| Tuesday | body_cam | night_patrol |
| Wednesday | ring_cam | compilation |
| Thursday | body_cam | trail |
| Friday | ring_cam | paranormal |
| Saturday | body_cam | compilation |

---

### `/caught-on-camera cron-setup`

Configure automated daily runs.

**WSL2 cron (primary):**
```bash
cat > ~/caught-on-camera-cron.sh << 'EOF'
#!/bin/bash
# IMPORTANT: Fill in API keys below. Never commit this file.
export FAL_KEY="YOUR_KEY_HERE"
export ANTHROPIC_API_KEY="YOUR_KEY_HERE"
export SUPABASE_URL="YOUR_URL_HERE"
export SUPABASE_SERVICE_KEY="YOUR_KEY_HERE"
export CLOUDINARY_CLOUD_NAME="YOUR_NAME_HERE"
export CLOUDINARY_API_KEY="YOUR_KEY_HERE"
export CLOUDINARY_API_SECRET="YOUR_SECRET_HERE"
export TELEGRAM_BOT_TOKEN="YOUR_TOKEN_HERE"
export TELEGRAM_CHAT_ID="YOUR_CHAT_ID_HERE"
export BLOTATO_API_KEY="YOUR_KEY_HERE"
export BLOTATO_YOUTUBE_ACCOUNT_ID="YOUR_ID_HERE"
export BLOTATO_INSTAGRAM_ACCOUNT_ID="YOUR_ID_HERE"
export BLOTATO_TIKTOK_ACCOUNT_ID="YOUR_ID_HERE"

cd ~/caught_on_camera
claude -p "/caught-on-camera run" --output-format text >> ~/caught-on-camera.log 2>&1
EOF
chmod +x ~/caught-on-camera-cron.sh

# Schedule daily at 8:00 AM:
crontab -e
# Add this line:
0 8 * * * /bin/bash ~/caught-on-camera-cron.sh

# Weekly ideator run (Sunday 9 AM — replenish ideas queue):
0 9 * * 0 /bin/bash -c "cd ~/caught_on_camera && npx tsx src/pipeline/ideator.ts --bulk" >> ~/caught-on-camera-ideator.log 2>&1
```

**Windows Task Scheduler (for always-on Windows machine):**

Create `C:\caught-on-camera-run.bat`:
```bat
@echo off
wsl bash /home/YOUR_WSL_USERNAME/caught-on-camera-cron.sh
```

Task Scheduler settings:
- Trigger: Daily at 8:00 AM
- Action: Run `C:\caught-on-camera-run.bat`
- Setting: Run whether user is logged on or not
- Setting: Wake computer to run task

Important:
- Replace `YOUR_KEY_HERE` placeholders in cron script — never commit the cron script to git
- Add `~/caught-on-camera-cron.sh` to `.gitignore`
- Test: run `bash ~/caught-on-camera-cron.sh` manually before enabling cron

---

### `/caught-on-camera takedown <video_id | all>`

Emergency removal from all platforms.

```bash
# Take down a single video
npm run emergency-takedown -- abc123

# Take down ALL published videos (e.g., category-wide recall)
npm run emergency-takedown -- all

# Preview what would be taken down (no changes made)
npm run emergency-takedown -- abc123 --dry-run
npm run emergency-takedown -- all --dry-run
```

Takedown actions (per video):
1. Call Blotato DELETE API for each platform publish
2. Fallback: direct platform API (YouTube, TikTok, Instagram) if Blotato unavailable
3. Set `videos.status = 'taken_down'` and `taken_down_at = NOW()` in DB
4. Write to `takedown_log` with platforms removed, timestamp
5. Send Telegram confirmation alert

Emergency takedown for entire category (e.g., police_security recall):
```bash
# First, dry-run to see scope
npm run emergency-takedown -- all --dry-run

# Check status output to see what's published
npm run status

# Takedown all published videos
npm run emergency-takedown -- all
```

---

## Reference Tables

### Format Comparison

| Property | Ring Camera | Body Camera |
|----------|-------------|-------------|
| POV | Static, fixed mount | First-person, moving |
| Setting | Doorbell, porch, driveway | Walking, driving, hiking |
| Camera motion | Minimal (wind, insects only) | Continuous (sub-type intensity) |
| Sub-types | Single format | 4 sub-types |
| Virality threshold | ≥ 60/100 | ≥ 65/100 |
| Motion gate threshold | avgMotion ≤ 0.5 (max static) | avgMotion ≥ 1.5 (must move) |
| Audio gate | meanVolume -40dB to -10dB | meanVolume -35dB to -10dB |
| Overlay | ring_cam/standard.png variants | body_cam/<sub_type>/standard.png |
| Estimated cost per video | $3–6 | $5–10 |
| Primary content categories | 7 categories | 7 categories |

---

### Body Cam Sub-Types

| Sub-type | Camera aesthetic | Prompt anchor phrases | Shake intensity | Overlay |
|----------|-----------------|----------------------|-----------------|---------|
| police_security | Chest-mounted, pointing forward at waist height | "body cam footage", "security patrol", "officer perspective", "vest visible" | Medium | badge area blurred |
| hiker_trail | Wearable cam, trail environment | "trail camera", "hiking footage", "wilderness body cam", "footstep movement" | Low–Medium | trail cam UI |
| dashcam | Driver's seat, road-forward | "dashcam recording", "windshield view", "driving footage" | Low (road vibration) | dash UI |
| helmet_action | Helmet/head-mounted, wide angle | "helmet cam", "GoPro style", "action cam", "first person sport" | High | action cam frame |

---

### Budget Caps and Alerting Thresholds

| Threshold | Amount | Action |
|-----------|--------|--------|
| Daily target | $25 | No action — target spend |
| Daily warning | $40 | Telegram warning alert |
| Daily hard cap | $50 | Pipeline aborts, no generation |
| Retry reserve | $5 | Reserved from hard cap for retries |
| Effective generation budget | $45 | ($50 cap - $5 retry reserve) |

Cost per operation (approximate):
| Operation | Estimated Cost |
|-----------|---------------|
| Veo 3.1 clip generation (8s) | $2.00–$4.00 |
| Claude claude-sonnet-4-6 ideator run (10 concepts) | $0.10–$0.30 |
| Claude gate 4 content review (5 keyframes) | $0.05–$0.15 |
| Gate 2 face detection (Claude vision) | $0.05–$0.10 |
| Cloudinary storage + bandwidth | ~$0.01/video/day |

---

### 7-Gate Descriptions

| Gate | Name | Type | Fail Trigger | Fail Action |
|------|------|------|-------------|-------------|
| 1 | Motion gate | Soft | Ring cam: avgMotion > 0.5 (too much movement); Body cam: avgMotion < 1.5 (too stable) | Ring cam: regenerate clip (max 2×); Body cam: add_shake filter, re-run gate |
| 2 | Face detection + blur | Transform | Human face detected in keyframes | Apply FFmpeg blur to face bounding boxes. Always passes — never rejects. |
| 3 | Audio quality | Soft | Below silence floor (-40dB ring / -35dB body); above peak (-10dB) | Mix audio bed (-18dB) or replace audio track; re-run gate 3 |
| 4 | Content policy | Hard | Blocked word in prompt (Stage A); high/critical severity content in frames (Stage B) | Stage A: reject idea before Veo call (saves cost); Stage B: abort immediately, all subsequent gates skipped |
| 5 | Crop safety | Soft | Main subject not visible in 9:16 center crop safe zone | Mark cropSafe=false; limit distribution to YouTube/landscape only (no Shorts/TikTok/Reels) |
| 6 | Overlay verification | Hard | Overlay frame not detected in output video keyframes | Re-apply overlay compositing; re-run gate 6 (max 1 retry) |
| 7 | Disclosure watermark | Hard | "AI GENERATED" watermark absent from bottom-right of output | Abort video; alert Telegram; do not publish under any circumstances |

---

### Platform Posting Limits

| Platform | Max/Day | Min Hours Between | Max/Week |
|----------|---------|------------------|---------|
| YouTube | 2 | 4 | 10 |
| TikTok | 3 | 2 | 14 |
| Instagram | 2 | 4 | 10 |
| YouTube Shorts | 2 | 4 | 10 |

---

### Audio Bed Library Map

| File | Format | Mood | Used for |
|------|--------|------|---------|
| ambient_night.wav | ring_cam | Quiet, tense | Night shift, paranormal, animals at night |
| suburban_day.wav | ring_cam | Neutral, familiar | Delivery, wholesome, daytime animals |
| rainy_evening.wav | ring_cam | Moody, calm | Weather events, night footage |
| tense_drone.wav | ring_cam | Unsettling low drone | Paranormal, UFO, unexplained events |
| police_radio.wav | body_cam | Crackle, radio squelch | police_security sub-type |
| forest_ambience.wav | body_cam | Natural, calm | hiker_trail sub-type |
| road_traffic.wav | body_cam | Engine, road noise | dashcam sub-type |
| action_percussion.wav | body_cam | Rhythmic, energetic | helmet_action sub-type |

All audio beds mixed at -18dB under video audio to provide texture without overpowering.

---

### Common Error Scenarios and Resolutions

| Scenario | Cause | Resolution |
|----------|-------|------------|
| **Veo generation blocked / content filter** | Prompt contains sensitive content that passed sanitizer | Run sanitizePrompt with stricter context; check rewrite map; manually rewrite concept prompt |
| **Gate 1 fail loop (ring cam)** | Generated clip has too much camera shake (Veo artifact) | Reinforce prompt: "completely static camera, fixed position, no camera movement" |
| **Gate 1 fail loop (body cam)** | Clip too stable, shake filter insufficient | Increase shake intensity in degradation.ts; check vidstabtransform parameters |
| **Gate 3 fail: silent clip** | Veo generated a near-silent clip | Replace audio track with pure audio bed; if body cam, mix radio/nature bed at -12dB |
| **Gate 4 hard fail on post-gen review** | Generated video shows faces, law enforcement imagery, or violence | Reject clip; revise concept; add negative prompt to Veo call: "no faces, no people, no vehicles" |
| **Gate 6 fail: overlay not detected** | FFmpeg overlay composite failed silently | Check overlay PNG dimensions match video resolution; verify alpha channel; re-run compose step |
| **Gate 7 hard fail** | watermark burn command failed | Check FFmpeg drawtext font path (WSL2 vs Windows); verify font installed; never skip this gate |
| **Blotato API down** | Blotato maintenance or outage | Queue video in `manual_publish_queue` DB table; send Telegram alert; publish manually when Blotato recovers |
| **Budget cap hit mid-day** | Multiple retries or large clips | Pipeline aborts automatically; review `scene_costs` for most expensive operations; reduce clip length |
| **Suppression detected on TikTok** | Algorithm penalty, often from posting frequency | Posting frequency halved automatically; reduce to 1/day on TikTok; monitor for 7 days |
| **Supabase connection timeout** | Network or Supabase outage | SQLite fallback activates automatically; data syncs to Supabase on reconnect |
| **fal.ai queue timeout** | High demand / long generation queue | Exponential backoff up to 10 minutes; log timeout, alert Telegram, abort video (not retried same day) |
| **police_security idea fails ethics check** | Claude reviewConcept found real-misconduct framing | Reject idea; do not regenerate with similar concept; set ENABLE_POLICE_SUBTYPE=false if recurring |
| **Telegram review timeout (48h)** | Operator did not review | Bot re-sends reminder; if 72h no response, auto-reject video and alert |
| **Ideas queue empty** | Both ring_cam and body_cam ideas exhausted | Run ideator manually: `npx tsx src/pipeline/ideator.ts --bulk`; reduce virality threshold by 5 points if still empty |
