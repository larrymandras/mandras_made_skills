# Cryptid Vlog Skill

Daily AI-generated cryptid vlog — Yeti and Bigfoot stumble through cryptid-hunting misadventures. Claude orchestrates decisions; TypeScript scripts handle deterministic work (FFmpeg, API calls, DB writes).

## Commands

### `/cryptidvlog setup`

One-time setup. Walk through each step in order.

**Step 1 — Install Node.js dependencies**
```bash
cd ~/cryptidvlog && npm install
```

**Step 2 — Configure environment**
```bash
cp .env.example .env
# Edit .env — fill in all API keys (see .env.example for full list)
```

**Step 3 — Validate environment**
```bash
npm run check-env
```
All vars must report `set` before continuing.

**Step 4 — Run database migrations**
```bash
npm run setup-db
```
Or via Supabase CLI (recommended): `npx supabase db push`

**Step 5 — Verify DB**
`setup-db` should report all 5 migrations applied and both character seeds (yeti, bigfoot) present.

**Step 6 — Upload character reference images**

Place reference images in:
- `assets/characters/yeti/v1/` — `front.jpg`, `three-quarter.jpg`, `action.jpg`
- `assets/characters/bigfoot/v1/` — `front.jpg`, `three-quarter.jpg`, `action.jpg`

Character visual identity targets:
| Character | Fur | Eyes | Build |
|-----------|-----|------|-------|
| Yeti | White/silver | Blue-grey | 8–9 ft, Arctic-adapted |
| Bigfoot | Dark brown | Amber | 7–8 ft, Pacific Northwest |

**Step 7 — Add background music**

Place royalty-free tracks in `assets/music/`. Supported: `.mp3`, `.wav`.
Requirements: ambient/atmospheric, 1–5 min, loopable, low-key (won't compete with narration).

**Step 8 — Configure Telegram bot**

1. Create bot via @BotFather → get `TELEGRAM_BOT_TOKEN`
2. Add bot to monitoring channel → get `TELEGRAM_CHAT_ID`
3. Set both in `.env`

**Step 9 — Authenticate platforms**

- YouTube: run OAuth flow → get refresh token → `YOUTUBE_REFRESH_TOKEN`
- TikTok: developer console → `TIKTOK_ACCESS_TOKEN`
- Instagram: Graph API → `INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ACCOUNT_ID`

**Step 10 — Smoke test**
```bash
npm run smoke-test
```
All checks must pass before first run.

---

### `/cryptidvlog run`

Execute the full pipeline — generates, gates, assembles, and sends one video for human review.

**Step 1 — Pre-flight**
```bash
npm run check-env
```

**Step 2 — Check daily budget**
If `daily_budget_log.total_cost_usd >= $75.00` → abort:
```
Daily hard cap reached ($75.00). No videos will be generated today.
```

**Step 3 — Check buffer**
Count `videos WHERE status='approved' AND published_at IS NULL`.
If count >= 5 → skip:
```
Buffer healthy (N videos). Skipping generation.
```

**Step 4 — Pull concept**
Query `concept_injection_queue` for oldest `status='pending'` record.
If empty → auto-generate via Claude:
- Random hook type: cryptid-cam-fail | wildlife-misidentification | tourist-encounter | investigation-gone-wrong | documentary-parody | gear-review-disaster
- Random setting: Pacific Northwest forest | Appalachian Mountains | Scottish Highlands | Siberian tundra | Florida swamp | Utah desert

**Step 5 — Ideator**
Generate concept:
```json
{
  "conceptTitle": "Yeti Reviews Thermal Camera (Goes Poorly)",
  "hook": "POV: you're a cryptid and your roommate just bought a $3000 thermal camera",
  "sceneCount": 4,
  "characterFocus": "yeti",
  "estimatedCost": 22.50,
  "abEligible": true,
  "abPriorityScore": 75
}
```

**Step 6 — Scriptwriter**
Generate N scene scripts. First: validate character memory integrity — all episode callbacks must reference real past interactions in DB. Throw if invalid callback found.

**Step 7 — Producer (per scene)**
For each scene:
1. Generate video clip via fal.ai Veo 3.1 → Replicate fallback → slideshow fallback
2. Synthesize narration via ElevenLabs → Cartesia → OpenAI TTS
3. Run Gate 1 (consistency ≥ 70), Gate 2 (continuity), Gate 3 (body detection)
4. Retry once on gate fail → mark `degraded` if retry fails (don't abort)

**Step 8 — Full-video gates**
Run Gate 4 (content policy + DMCA) and Gate 7 (watermark + disclosure) on assembled video.
Hard fail on either → abort publish, send alert.

**Step 9 — Assembler**
```
concatenateScenes → mixAudio (-18dB music under narration) → applyCropSafeZone → burnWatermark
```
Output: final MP4, duration logged.

**Step 10 — Human review request**
Send Telegram message:
```
🎬 New video ready for review
Video ID: <id>
Concept: <title>
Scenes: N (all gates passed)
Cost: $XX.XX
A/B: base only

✅ approve <id>
❌ reject <id> [reason]
```
Set `status = 'pending_review'`.

**Step 11 — A/B variant (conditional)**
If `abEligible` AND `(today_spend + $16) < $75`:
Generate variant with alternate hook → same gate pipeline → separate review message.

---

### `/cryptidvlog status`

Show current pipeline state. Query and summarize:
- Buffer: `SELECT status, COUNT(*) FROM videos GROUP BY status`
- Today's spend: `SELECT SUM(total_cost_usd) FROM daily_budget_log WHERE date = CURRENT_DATE`
- Vendor health: latest status per vendor from `current_vendor_health` view
- Queue depth: `SELECT COUNT(*) FROM concept_injection_queue WHERE status='pending'`

Output a plain-English summary: buffer depth, spend vs $75 cap, any vendor issues, queue size.

---

### `/cryptidvlog review`

List all videos pending human review:
```sql
SELECT id, concept_title, scene_count, total_cost_usd, created_at
FROM videos WHERE status = 'pending_review'
ORDER BY created_at;
```
Display each with gate scores and Telegram approve/reject instructions.

---

### `/cryptidvlog approve <video_id>`

Mark video approved and trigger publish:
```sql
UPDATE videos SET status = 'approved', approved_at = NOW() WHERE id = '<video_id>';
```
Then publish to all platforms:
```bash
npm run publish -- --video-id <video_id>
```
Sets synthetic media label and not-for-kids flag on all platforms.

---

### `/cryptidvlog reject <video_id> [reason]`

Reject video and log reason:
```sql
UPDATE videos SET status = 'rejected', rejection_reason = '<reason>', rejected_at = NOW()
WHERE id = '<video_id>';
```
Video stored for analysis. Concept may be re-queued with adjustment notes.

---

### `/cryptidvlog cron-setup`

Configure automated daily runs.

**WSL2 cron (primary):**
```bash
cat > ~/cryptidvlog-cron.sh << 'EOF'
#!/bin/bash
export ANTHROPIC_API_KEY="YOUR_KEY_HERE"
export OPENAI_API_KEY="YOUR_KEY_HERE"
export FAL_API_KEY="YOUR_KEY_HERE"
cd ~/cryptidvlog
claude -p "/cryptidvlog run" --output-format text >> ~/cryptidvlog.log 2>&1
EOF
chmod +x ~/cryptidvlog-cron.sh

# Schedule daily at 7am:
crontab -e
# Add: 0 7 * * * /bin/bash ~/cryptidvlog-cron.sh
```

**Windows Task Scheduler (for always-on Windows machine):**

Create `C:\cryptidvlog-run.bat`:
```bat
@echo off
wsl bash /home/YOUR_USERNAME/cryptidvlog-cron.sh
```

Task Scheduler settings:
- Trigger: Daily at 7:00 AM
- Action: `C:\cryptidvlog-run.bat`
- Setting: Run whether user is logged on or not

**Important:** Replace `YOUR_KEY_HERE` in the cron script. Never commit it.

---

### `/cryptidvlog takedown <video_id> [reason]`

Emergency removal from all platforms.
```bash
npm run emergency-takedown -- --video-id <video_id> --reason "DMCA notice"
```

Actions:
1. Delete from YouTube, TikTok, Instagram via each platform API
2. Set `videos.status = 'taken_down'`
3. Write to `takedown_log`
4. If reason contains "DMCA": strip audio from stored file
5. Send Telegram alert: `🚨 Video <id> taken down from all platforms`

---

## Character Reference

| Character | Species | Height | Fur | Eyes | Voice Range | Personality |
|-----------|---------|--------|-----|------|-------------|-------------|
| Yeti | Himalayan Yeti | 8–9 ft | White/silver | Blue-grey | 170–290 Hz | Anxious tech nerd, conspiracy-prone |
| Bigfoot | North American Sasquatch | 7–8 ft | Dark brown | Amber | 80–180 Hz | Laid-back outdoorsman, skeptical of tech |

---

## Budget Caps

| Category | Daily Limit |
|----------|-------------|
| Hard cap (all spend) | $75.00 |
| A/B variant per video | $16.00 |
| Retry reserve | $8.00 |
| Target spend per day | $45.00 |

---

## Gate Pipeline

| Gate | Name | Threshold | Fail Type |
|------|------|-----------|-----------|
| 1 | Character Consistency | ≥ 70/100 | Soft (mark degraded) |
| 2 | Scene Continuity | Pass | Soft (retry 1×) |
| 3 | Body Detection | > 50% frames | Soft (skip scene) |
| 4 | Content Policy + DMCA | No flags | **Hard fail** |
| 5 | Voice Quality | MOS ≥ 0.8 | Soft (retry 1×) |
| 6 | Crop Safety (9:16) | All UI in safe zone | Soft (re-crop) |
| 7 | Watermark + Disclosure | Both present | **Hard fail** |

---

## Vendor Fallback Chains

| Service | Primary | Fallback 1 | Fallback 2 |
|---------|---------|-----------|-----------|
| Video generation | fal.ai Veo 3.1 | Replicate | Slideshow |
| AI text/vision | Claude (Anthropic) | GPT-4o (OpenAI) | — |
| Voice synthesis | ElevenLabs | Cartesia | OpenAI TTS |
| Database | Supabase | SQLite (local) | — |

---

## Error Reference

| Situation | Action |
|-----------|--------|
| Daily cap reached ($75) | Abort — no generation |
| Buffer healthy (≥ 5 videos) | Skip generation |
| Gate 4 hard fail | Abort publish, strip audio if DMCA, log |
| Gate 7 hard fail | Abort publish, re-assemble with watermark |
| All video vendors down | Slideshow fallback, Telegram alert |
| All voice vendors down | Abort scene, mark failed |
| Supabase down | SQLite fallback, sync on recovery |
| Concept queue empty | Auto-generate via Claude |
| Human review timeout (48h) | Re-send Telegram reminder |
