---
name: digital-art-factory
description: >
  Daily AI art factory. Reads the oldest reference image from a Google Drive
  queue folder, analyzes its visual DNA with Claude vision, generates 10
  cinematic fantasy art variations via gpt-image-1, saves them to Google Drive,
  and archives the reference. Designed for cron job automation.
  Commands: setup | run | status | cron-setup
---

# Digital Art Factory

Daily cinematic AI art pipeline. Fetches the oldest reference image from a
Google Drive queue, uses Claude's native vision to extract its visual DNA,
generates 10 photorealistic cinematic fantasy variations via gpt-image-1, uploads
them to Google Drive, and archives the reference — all headless and cron-ready.

---

## Model Roles

| Role | Model | Reason |
|------|-------|--------|
| Vision analysis | Claude claude-sonnet-4-6 (native) | Reads the image directly — no extra API call |
| Prompt generation | Claude claude-sonnet-4-6 (native) | In-context after analysis, no extra agent |
| Image generation | gpt-image-1 via OpenAI API | High quality 9:16 photorealistic output |

---

## Google Drive Folder Structure

```
Google Drive/
├── daf-daily-references/    ← pre-load reference images here (queue, oldest-first)
├── daf-archive/             ← processed references moved here automatically
└── daf-new-images/          ← 10 generated images saved here per run
```

---

## Commands

### `/digital-art-factory setup`

One-time checklist. Walk the user through each step:

1. **Install rclone**
   - Windows: `winget install Rclone.Rclone`
   - Mac: `brew install rclone`
   - Linux: `sudo apt install rclone` or `curl https://rclone.org/install.sh | bash`

2. **Configure Google Drive remote** (named `gdrive`)
   ```bash
   rclone config
   # → New remote → name: gdrive → type: Google Drive → follow OAuth flow
   ```

3. **Create the 3 Drive folders**
   ```bash
   rclone mkdir "gdrive:daf-daily-references"
   rclone mkdir "gdrive:daf-archive"
   rclone mkdir "gdrive:daf-new-images"
   ```

4. **Set OpenAI API key** in shell profile (`~/.bashrc`, `~/.zshrc`, or `~/.bash_profile`):
   ```bash
   export OPENAI_API_KEY="sk-..."
   ```

5. **Verify setup**
   ```bash
   rclone ls "gdrive:daf-daily-references"
   echo $OPENAI_API_KEY
   ```

6. **Upload a test reference image** to `gdrive:daf-daily-references` via the
   Google Drive web UI or rclone:
   ```bash
   rclone copy /path/to/image.jpg "gdrive:daf-daily-references/"
   ```

---

### `/digital-art-factory run`

Execute the full pipeline. Perform each step in order, stopping on critical failures.

---

#### Step 1 — Get oldest reference image

```bash
rclone lsjson "gdrive:daf-daily-references" \
  --order-by "modtime,ascending" \
  --max-depth 1
```

Parse the JSON array. Extract the `Name` field from the **first** entry.

**Empty queue check:** If the array is empty or returns no results, output:
```
Queue is empty. Upload reference images to gdrive:daf-daily-references to continue.
```
Then stop — do not proceed.

Store `$REF_NAME` = filename of oldest image.

---

#### Step 2 — Download to temp

```bash
mkdir -p /tmp/daf-ref /tmp/daf-output
rclone copy "gdrive:daf-daily-references/$REF_NAME" /tmp/daf-ref/
```

Verify the file exists at `/tmp/daf-ref/$REF_NAME` before continuing.

---

#### Step 3 — Analyze with Claude vision

Read the downloaded image at `/tmp/daf-ref/$REF_NAME` using the Read tool.

Extract visual DNA as structured JSON — do not invent details not visible in the image:

```json
{
  "subject_type": "female dark knight",
  "armor_style": "black ornate leather with gold trim",
  "weapon_type": "longsword",
  "weapon_glow_color": "electric blue",
  "color_palette": ["charcoal black", "gold", "electric blue"],
  "lighting_style": "dramatic atmospheric fog",
  "environment_type": "cobblestone medieval street",
  "mood": "powerful and mysterious",
  "camera_framing": "full body portrait",
  "art_style": "photorealistic cinematic 8K"
}
```

---

#### Step 4 — Generate 10 variation prompts

Generate 10 distinct prompts in-context using the visual DNA. Each prompt should:
- Preserve the core armor aesthetic and realism level from the reference
- Rotate through the variation axes below (one per prompt, no repeats within a run)
- Be 3–4 sentences, specific and cinematic
- End with: `Resolution: 8K | Aspect Ratio: 9:16 | Rendering: Ultra-detailed HDR`

**Archetype rotation (use all 10):**
ranger, mage, paladin, assassin, sorceress, valkyrie, necromancer, druid,
shadow hunter, elemental knight

**Environment rotation (use all 10):**
enchanted forest, underground dungeon, desert ruins, arctic tundra,
volcanic cliffs, underwater temple, storm castle, moonlit graveyard,
neon city rooftop, crystal cavern

**Weapon glow color rotation (use all 10):**
crimson, violet, emerald, gold, cyan, white, orange, pink, silver, teal

Pair each archetype with one environment and one glow color in order (index 1–10).

---

#### Step 5 — Generate 10 images via gpt-image-1

For each prompt (numbered 1–10), run sequentially with a 2-second sleep between
calls. Capture today's date for filenames: `DATE=$(date +%Y%m%d)`

```bash
curl -s -X POST https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-1",
    "prompt": "<PROMPT_N>",
    "size": "1024x1536",
    "quality": "high",
    "output_format": "jpeg",
    "output_compression": 85
  }' | jq -r '.data[0].b64_json' \
  | base64 --decode > /tmp/daf-output/variation_<N>_$DATE.jpg
sleep 2
```

**Per-image error handling:** If `jq` returns null or the curl exits non-zero,
log the error and continue to the next image. Do not abort the whole run for a
single failure. Track which images failed.

After all 10 attempts, count successful files:
```bash
ls /tmp/daf-output/*.jpg | wc -l
```

If 0 files were generated, abort — do not upload or archive.

---

#### Step 6 — Upload to Google Drive new_images

```bash
rclone copy /tmp/daf-output/ "gdrive:daf-new-images/"
```

Verify upload by counting files in the destination:
```bash
rclone ls "gdrive:daf-new-images/" | grep "$DATE" | wc -l
```

If the upload count is 0 (upload failed entirely), **do not archive** the reference.
Log the error and stop.

---

#### Step 7 — Archive reference image

Only runs after Step 6 confirms at least 1 file uploaded successfully:

```bash
rclone move "gdrive:daf-daily-references/$REF_NAME" "gdrive:daf-archive/"
```

---

#### Step 8 — Cleanup temp

```bash
rm -rf /tmp/daf-ref /tmp/daf-output
```

---

#### Step 9 — Report

Output a clean summary:

```
✓ Reference: <REF_NAME> → gdrive:daf-archive/
✓ Generated: <N>/10 images → gdrive:daf-new-images/
✓ Archetypes: ranger, mage, paladin, assassin, sorceress, valkyrie, necromancer, druid, shadow hunter, elemental knight
  (any failed generations listed here with their error)
```

---

### `/digital-art-factory status`

Show current state of all three Drive folders:

```bash
echo "=== Queue (daf-daily-references) ==="
rclone ls "gdrive:daf-daily-references"

echo ""
echo "=== Archive (daf-archive) - total count ==="
rclone ls "gdrive:daf-archive" | wc -l

echo ""
echo "=== New Images (daf-new-images) - 20 most recent ==="
rclone lsjson "gdrive:daf-new-images" \
  --order-by "modtime,descending" \
  --max-depth 1 | jq -r '.[0:20][].Name'
```

Summarize the output in plain English (queue count, archive count, recent outputs).

---

### `/digital-art-factory cron-setup`

Generate a cron-ready shell script at `~/daf-cron.sh` and show the crontab entry.

**Write this script to `~/daf-cron.sh`:**

```bash
#!/bin/bash
# Digital Art Factory - daily cron runner
export OPENAI_API_KEY="YOUR_KEY_HERE"
claude -p "/digital-art-factory run" --output-format text >> ~/digital-art-factory.log 2>&1
```

Then show the user:

```
Script created at: ~/daf-cron.sh

To schedule daily at 8am, run:
  crontab -e

Add this line:
  0 8 * * * /bin/bash ~/daf-cron.sh

Make executable:
  chmod +x ~/daf-cron.sh

Replace YOUR_KEY_HERE with your actual OPENAI_API_KEY in ~/daf-cron.sh
```

**Important:** Do not write the actual API key into the file. Prompt the user to
fill in `YOUR_KEY_HERE` manually after creation for security.

---

## Error Reference

| Situation | Action |
|-----------|--------|
| Empty queue | Exit gracefully with message — do not error |
| Single image generation failure | Log and continue remaining images |
| All 10 image generations fail | Abort — do not upload, do not archive |
| rclone upload returns 0 files | Abort archive step — retry safety |
| rclone download fails | Stop pipeline — cannot analyze missing file |
| `$OPENAI_API_KEY` not set | Exit with clear message before Step 5 |
