---
date: 2026-03-17
tags: [cryptidvlog, implementation-plan, character-consistency]
status: active
---

# Character Sheet + Pose-Tagged Reference Image System — Implementation Plan

## Overview

This plan covers six workstreams that deliver character sheets (YAML), a pose-tagged reference image system, a sheet loader with caching, a DB migration, pipeline integration for all four stubbed stages, and a new slash command. The goal: every pipeline stage has rich, structured character knowledge and pose-matched visual references, producing consistent Yeti and Bigfoot across episodes.

---

## Dependency Graph

```
Phase 1 (foundation — all parallel)
  ├─ 1A  Character Sheet YAMLs
  ├─ 1B  Pose Taxonomy + Directory Structure
  └─ 1C  DB Migration 006

Phase 2 (loader — depends on 1A, 1C)
  └─ 2A  Sheet Loader + Zod Schema + Cache

Phase 3 (reference image tooling — depends on 1B, 1C)
  └─ 3A  Reference Image Registration Script

Phase 4 (pipeline integration — depends on 2A, 3A)
  ├─ 4A  Ideator integration (depends on 2A)
  ├─ 4B  Scriptwriter integration (depends on 2A)
  ├─ 4C  Gate 1 integration (depends on 2A, 3A)
  └─ 4D  Producer integration (depends on 2A, 3A)
  [4A and 4B can run in parallel; 4C and 4D can run in parallel after 4A/4B]

Phase 5 (slash command — depends on 2A)
  └─ 5A  /cryptidvlog character command

Phase 6 (testing — depends on all above)
  └─ 6A  Tests for loader, registration script, pipeline integration
```

---

## Phase 1 — Foundation (all three tasks are independent; run in parallel)

### 1A: Character Sheet YAML Files

**Create:**
- `assets/characters/yeti/sheet.yaml`
- `assets/characters/bigfoot/sheet.yaml`

**Structure for each sheet:**

```yaml
version: 1
name: yeti  # or bigfoot
species: Himalayan Yeti

physical:
  height_ft: [8.0, 9.0]
  build: "Massive, barrel-chested, slightly hunched posture"
  fur:
    color: "White/silver"
    texture: "Long, shaggy, matted at elbows and knees"
    seasonal_variation: "Slightly yellowed in summer episodes"
  face:
    eyes: "Blue-grey, large, expressive, perpetually wide"
    brow: "Heavy, prominent brow ridge"
    nose: "Broad, flat, dark grey"
    mouth: "Wide, often agape in surprise"
    teeth: "Blunt, slightly yellowed"
    expression_default: "Anxious/alert"
  hands: "Enormous, five fingers, dark grey palms"
  feet: "Massive, size 28 equivalent, dark soles"
  distinguishing_marks:
    - "Scar on left forearm from WiFi router incident"
    - "Slightly crooked right ear"
  clothing:
    - "Never wears clothes — fur only"
    - "Sometimes wears a headlamp (often upside down)"

voice:
  range_hz: [170, 290]
  timbre: "Reedy, nasal, slightly high for his size"
  speech_patterns:
    - "Speaks fast when anxious (which is always)"
    - "Trails off mid-sentence when distracted by tech"
    - "Uses internet slang unironically ('literally', 'no cap', 'sus')"
  catchphrases:
    - "Okay okay okay okay—"
    - "This is EXACTLY what I was afraid of."
    - "I saw a video about this..."
  verbal_tics:
    - "Nervous laughter before bad news"
    - "Whispers conspiracy asides to camera"
  never_say:
    - "Slurs or hate speech of any kind"
    - "Real brand names (use parodies)"
    - "References to real people by name"

personality:
  core_traits:
    - "Anxious, catastrophizing"
    - "Tech-obsessed but incompetent"
    - "Genuinely kind under the neurosis"
    - "Conspiracy-prone (believes everything online)"
  fears:
    - "Being filmed (ironic for a vlogger)"
    - "Thermal cameras"
    - "His own shadow"
    - "Silence"
  loves:
    - "WiFi"
    - "Unboxing videos"
    - "Conspiracy forums"
    - "Bigfoot (though he'd never admit the depth)"
  quirks:
    - "Narrates his own actions in third person when stressed"
    - "Panic-buys gadgets at 3am"

relationships:
  bigfoot:
    dynamic: "Odd-couple roommates / reluctant adventure partners"
    yeti_sees_bigfoot_as: "The only person who gets him (mostly)"
    tension_source: "Yeti's tech obsession vs Bigfoot's luddism"
    running_jokes:
      - "Yeti always breaking Bigfoot's plants with gadgets"
      - "Bigfoot hiding Yeti's phone chargers"
      - "'Remember the drone incident' — both remember it differently"

backstory:
  origin: "Former Himalayan mountain monk who discovered WiFi in 2019"
  arc: "Slowly learning that not everything online is true"
  secrets:
    - "Has a secret TikTok account with 12 followers"
    - "Once accidentally called animal control on himself"

constraints:
  never_do:
    - "Harm another character physically (slapstick accidents OK)"
    - "Use real-world slurs or hate speech"
    - "Reference real people by name"
    - "Break the fourth wall about being AI-generated"
    - "Be mean-spirited — awkward and anxious, never cruel"
  always:
    - "Show genuine care for Bigfoot beneath the bickering"
    - "React to technology with a mix of wonder and terror"
    - "Maintain consistent fur color, eye color, and body proportions"

visual_direction:
  color_palette: ["#F0F0F0", "#C0C8D0", "#4A6B8A"]
  lighting_notes: "Cool-toned, blue-grey ambient. Screens cast warm glow on face."
  camera_angles_preferred: ["low angle (emphasize height)", "over-shoulder POV at screens"]
  environment_associations: ["snowy peaks", "cluttered tech-filled cave", "server rooms"]
  pose_personality_map:
    nervous: "Hunched shoulders, wringing hands, wide eyes"
    excited: "Leaning forward, arms out, mouth open"
    conspiratorial: "Leaning in close to camera, one hand shielding mouth"
```

Bigfoot's sheet follows the same structure with his specific traits (laid-back, outdoorsy, 400-year PNW veteran, coffee snob, plant whisperer, deep voice, dry humor).

**Dependencies:** None.
**Output:** Two YAML files ready for the loader.

---

### 1B: Pose Taxonomy + Directory Structure

**Define canonical pose set (constant in code and used as DB enum):**

| Pose Key | Description | Primary Use |
|----------|-------------|-------------|
| `front` | Full body, facing camera | Default reference |
| `three-quarter` | 3/4 view, slight turn | Most natural angle |
| `profile` | Side view | Walking/transition scenes |
| `back` | Rear view | Walking-away shots |
| `action-running` | Mid-stride, dynamic pose | Chase/escape scenes |
| `action-talking` | Gesturing, mouth open | Dialogue scenes |
| `close-up-face` | Head and shoulders only | Reaction shots |
| `environment` | Character in typical setting | Establishing shots |

**Create directories (empty, with `.gitkeep`):**

```
assets/characters/yeti/v1/.gitkeep
assets/characters/bigfoot/v1/.gitkeep
```

**Create pose taxonomy file:**
- `src/characters/poses.ts` — exports `CANONICAL_POSES` array, `PoseTag` type, and `poseMatchScore()` utility (given a target pose and available poses, returns best match with confidence).

**Dependencies:** None.
**Output:** Directory structure, pose type definitions.

---

### 1C: DB Migration 006

**Create:** `migrations/006_character_sheets.sql`

**Changes:**

1. Add columns to `characters`:
   - `sheet_version INTEGER NOT NULL DEFAULT 0`
   - `sheet_yaml TEXT` (stores full YAML for DB-side queries)
   - `sheet_updated_at TIMESTAMPTZ`

2. Add `NOT NULL` constraint to `character_reference_images.pose`:
   - First: `UPDATE character_reference_images SET pose = 'untagged' WHERE pose IS NULL;`
   - Then: `ALTER TABLE character_reference_images ALTER COLUMN pose SET NOT NULL;`
   - Then: `ALTER TABLE character_reference_images ALTER COLUMN pose SET DEFAULT 'untagged';`

3. Add pose check constraint:
   ```sql
   ALTER TABLE character_reference_images
   ADD CONSTRAINT chk_pose_valid
   CHECK (pose IN ('front','three-quarter','profile','back',
                    'action-running','action-talking','close-up-face',
                    'environment','untagged'));
   ```

4. Add index on pose for fast lookups:
   ```sql
   CREATE INDEX idx_reference_images_pose
   ON character_reference_images(character_name, pose, is_active);
   ```

**Dependencies:** None (migrations run sequentially by number).
**Output:** Migration file ready for `npm run setup-db`.

---

## Phase 2 — Sheet Loader (depends on 1A and 1C)

### 2A: Sheet Loader + Zod Schema + Cache

**Create:** `src/characters/sheet-loader.ts`

**Responsibilities:**

1. **Zod schema** (`CharacterSheetSchema`) — validates the full YAML structure. Nested schemas for `physical`, `voice`, `personality`, `relationships`, `backstory`, `constraints`, `visual_direction`. Export the inferred TypeScript type as `CharacterSheet`.

2. **`loadSheet(name: string): Promise<CharacterSheet>`** — reads `assets/characters/{name}/sheet.yaml`, parses with `yaml` (add `yaml` package to `package.json`), validates with Zod, returns typed object. Throws descriptive error on validation failure.

3. **In-memory cache** — `Map<string, { sheet: CharacterSheet; loadedAt: number }>`. Cache TTL: 5 minutes (configurable). `clearSheetCache()` export for testing.

4. **`syncSheetToDb(name: string): Promise<void>`** — after loading, writes `sheet_yaml`, `sheet_version`, `sheet_updated_at` to `characters` table. Called on load if DB version is stale.

5. **`getSheetSummaryForPrompt(name: string): string`** — returns a flattened text summary suitable for injection into LLM prompts. Includes physical description, personality, catchphrases, never-do constraints, relationship dynamics. Does NOT include visual_direction (that's for the producer only).

6. **`getVisualDirectionForPrompt(name: string): string`** — returns visual_direction block formatted for video generation prompts.

**Also create:** `src/characters/index.ts` — barrel export for `sheet-loader.ts` and `poses.ts`.

**Modify:** `package.json` — add `yaml` (e.g., `yaml: "^2.4.0"`) to dependencies.

**Dependencies:** Phase 1A (YAML files exist), Phase 1C (DB columns exist).
**Output:** Fully typed, cached, validated character sheet loading.

---

## Phase 3 — Reference Image Registration (depends on 1B and 1C)

### 3A: Reference Image Registration Script

**Create:** `scripts/register-references.ts`

**Behavior:**

1. Scan `assets/characters/{name}/v{version}/` for image files (`*.jpg`, `*.png`, `*.webp`).
2. Parse filename to extract pose tag: `front.jpg` -> pose `front`. Files not matching a canonical pose get tagged `untagged`.
3. For each image:
   - Check if already registered in DB (by `character_name` + `file_path`).
   - If new: insert into `character_reference_images` with `source='manual'`, `version`, `pose`, `is_active=true`.
   - If version changed: set old version's `is_active=false`, insert new.
4. Print summary: registered N images for character X, version Y.

**CLI usage:**
```bash
npx tsx scripts/register-references.ts           # all characters
npx tsx scripts/register-references.ts --name yeti --version 1
```

**Modify:** `package.json` — add `register-refs` script: `tsx scripts/register-references.ts`.

**Modify:** `src/db/characters.ts` — add `getActiveReferenceByPose(characterName: string, pose: string): Promise<Record<string, unknown> | null>` that queries for the best active reference matching the requested pose. Fallback order: exact pose -> `three-quarter` -> `front` -> any active.

**Dependencies:** Phase 1B (directory structure + pose types), Phase 1C (NOT NULL pose, enum constraint).
**Output:** Script to populate DB, new DB query function.

---

## Phase 4 — Pipeline Integration (depends on 2A and 3A)

All four sub-tasks modify stubbed files. 4A and 4B are independent of each other. 4C and 4D are independent of each other but both depend on at least 4A or 4B being done (for the updated types).

### 4A: Ideator Integration

**Modify:** `src/pipeline/ideator.ts`

**Changes:**
1. Import `loadSheet`, `getSheetSummaryForPrompt` from `src/characters/index.js`.
2. In `generateConcept()`, after selecting hook type and setting:
   - Load both character sheets.
   - Build prompt that includes personality summaries, fears, loves, relationship dynamics, running jokes.
   - Prompt instructs Claude to pick concepts that play to character strengths (e.g., tech-related concepts favor Yeti focus, outdoor/nature concepts favor Bigfoot).
3. Add `characterSheetVersions: Record<string, number>` to `Concept` interface — records which sheet version was used (for traceability).

**Dependencies:** Phase 2A.

### 4B: Scriptwriter Integration

**Modify:** `src/pipeline/scriptwriter.ts`

**Changes:**
1. Import `loadSheet`, `getSheetSummaryForPrompt`, `getVisualDirectionForPrompt` from `src/characters/index.js`.
2. Import `CANONICAL_POSES`, `PoseTag` from `src/characters/poses.js`.
3. In `writeScript()`:
   - Load sheets for all characters in the concept's `characterFocus`.
   - Build system prompt with full sheet summaries: personality, catchphrases, verbal tics, never-say, relationship dynamics, backstory.
   - Instruct Claude to write dialogue using the character's speech patterns and catchphrases naturally.
   - Instruct Claude to include `targetPose` in each scene's `visualDirection` — must be one of `CANONICAL_POSES`.
4. Add `targetPose: PoseTag` to `SceneScript` interface.
5. Memory validation stays as-is (call `validateMemoryIntegrity` on outline before full generation).

**Dependencies:** Phase 2A.

### 4C: Gate 1 Integration

**Modify:** `src/gates/gate1-consistency.ts`

**Changes:**
1. Import `loadSheet` from `src/characters/index.js`.
2. Import `getActiveReferenceByPose` from `src/db/characters.js`.
3. Update `runGate1` signature to accept optional `targetPose: string`.
4. Implementation:
   - Load character sheet for physical description text.
   - Call `getActiveReferenceByPose(characterName, targetPose)` to get the best pose-matched reference image.
   - Read reference image from disk, convert to base64.
   - Build vision prompt: "Compare the scene frames against this reference image. The character should match: {physical description from sheet}. Score 0-100 for consistency."
   - Parse score, save if above threshold, return result.
5. If no reference image exists for character, log warning and skip (return pass=true with score=0 and a `noReference: true` flag).

**Modify:** `src/gates/gate1-consistency.ts` — update `Gate1Result` to include `poseUsed: string`.

**Dependencies:** Phase 2A, Phase 3A.

### 4D: Producer Integration

**Modify:** `src/pipeline/producer.ts`

**Changes:**
1. Import `getVisualDirectionForPrompt` from `src/characters/index.js`.
2. In `produceScenes()`:
   - For each scene, read `targetPose` from the `SceneScript`.
   - Build video generation prompt that includes visual direction from the character sheet: color palette, lighting notes, preferred camera angles, environment associations.
   - Include the `pose_personality_map` entry for the scene's emotional tone.
   - Pass `targetPose` to `runGate1()`.
3. Update `ProducedScene` to include `targetPose: string`.

**Dependencies:** Phase 2A, Phase 3A, and ideally 4B (for updated `SceneScript` type with `targetPose`).

---

## Phase 5 — Slash Command (depends on 2A)

### 5A: `/cryptidvlog character` Command

**Modify:** `SKILL.md` — add new command documentation.

**Modify:** `src/index.ts` — add `character` command routing.

**Create:** `src/commands/character.ts`

**Subcommands:**

1. **`/cryptidvlog character <name>`** (view)
   - Load sheet via `loadSheet(name)`.
   - Print formatted summary: physical traits, personality, catchphrases, relationship dynamics, current sheet version.
   - Print reference image status: count of active references per pose, latest consistency scores.

2. **`/cryptidvlog character update <name>`** (bump version)
   - Increment `sheet_version` in the YAML file's `version` field.
   - Call `syncSheetToDb(name)` to push to DB.
   - Log change with timestamp.
   - Print confirmation with old version -> new version.

**Dependencies:** Phase 2A.

---

## Phase 6 — Testing (depends on all above)

### 6A: Tests

**Create:** `tests/unit/characters/sheet-loader.test.ts`
- Valid YAML loads and validates.
- Invalid YAML (missing required field) throws with descriptive message.
- Cache returns same object on second call within TTL.
- Cache expires after TTL.
- `getSheetSummaryForPrompt` returns string containing catchphrases and never-do constraints.
- `getVisualDirectionForPrompt` returns string containing color palette.

**Create:** `tests/unit/characters/poses.test.ts`
- `poseMatchScore` returns exact match at highest confidence.
- Fallback to `three-quarter` when exact pose unavailable.
- Fallback to `front` when `three-quarter` also unavailable.
- `untagged` is lowest priority.

**Create:** `tests/unit/db/characters.test.ts`
- `getActiveReferenceByPose` returns exact pose match.
- `getActiveReferenceByPose` falls back correctly.
- `getActiveReferenceByPose` returns null when no references exist.

**Create:** `tests/unit/scripts/register-references.test.ts`
- Filename parsing extracts correct pose tags.
- Unknown filenames get `untagged`.
- Version bump deactivates old references.

**Dependencies:** All phases complete.

---

## File Manifest

### New Files (12)

| # | Path | Phase |
|---|------|-------|
| 1 | `assets/characters/yeti/sheet.yaml` | 1A |
| 2 | `assets/characters/bigfoot/sheet.yaml` | 1A |
| 3 | `assets/characters/yeti/v1/.gitkeep` | 1B |
| 4 | `assets/characters/bigfoot/v1/.gitkeep` | 1B |
| 5 | `src/characters/poses.ts` | 1B |
| 6 | `migrations/006_character_sheets.sql` | 1C |
| 7 | `src/characters/sheet-loader.ts` | 2A |
| 8 | `src/characters/index.ts` | 2A |
| 9 | `scripts/register-references.ts` | 3A |
| 10 | `src/commands/character.ts` | 5A |
| 11-14 | `tests/unit/characters/sheet-loader.test.ts`, `poses.test.ts`, `tests/unit/db/characters.test.ts`, `tests/unit/scripts/register-references.test.ts` | 6A |

### Modified Files (9)

| # | Path | Phase | Change |
|---|------|-------|--------|
| 1 | `package.json` | 2A | Add `yaml` dependency, `register-refs` script |
| 2 | `src/db/characters.ts` | 3A | Add `getActiveReferenceByPose()` |
| 3 | `src/pipeline/ideator.ts` | 4A | Inject character sheet context, update Concept type |
| 4 | `src/pipeline/scriptwriter.ts` | 4B | Full sheet as system context, add targetPose to SceneScript |
| 5 | `src/gates/gate1-consistency.ts` | 4C | Pose-matched reference + physical description comparison |
| 6 | `src/pipeline/producer.ts` | 4D | Visual direction + pose hints in generation prompt |
| 7 | `src/index.ts` | 5A | Route `character` command |
| 8 | `SKILL.md` | 5A | Document character command |
| 9 | `src/gates/index.ts` | 4C | Update runAllGates to pass targetPose to gate1 |

---

## Execution Order (for a single developer)

```
Session 1 — Foundation (estimate: 1-2 hours)
  [parallel] Write yeti/sheet.yaml + bigfoot/sheet.yaml        (1A)
  [parallel] Create poses.ts + directory structure              (1B)
  [parallel] Write migration 006                                (1C)

Session 2 — Loader + Registration (estimate: 2-3 hours)
  [sequential] Build sheet-loader.ts + Zod schema + cache       (2A)
  [sequential] Build register-references.ts script              (3A)
  [sequential] Add getActiveReferenceByPose to characters.ts    (3A)

Session 3 — Pipeline Integration (estimate: 3-4 hours)
  [parallel] Ideator integration                                (4A)
  [parallel] Scriptwriter integration                           (4B)
  [after 4A+4B] Gate 1 integration                              (4C)
  [after 4A+4B] Producer integration                            (4D)

Session 4 — Command + Tests (estimate: 1-2 hours)
  [sequential] Slash command                                    (5A)
  [sequential] All tests                                        (6A)
```

---

## Risk Notes

1. **YAML library choice**: `yaml` (v2) is the standard. Do NOT use `js-yaml` — it has known issues with nested anchors. Already using `zod` for validation, so the combination is solid.

2. **Pose matching fallback**: The `getActiveReferenceByPose` fallback chain (`exact -> three-quarter -> front -> any`) is critical. Without it, Gate 1 silently passes on missing references, which defeats the purpose.

3. **Sheet version drift**: The `syncSheetToDb` function must be called on every load where the file version exceeds the DB version. Otherwise the DB and filesystem diverge.

4. **Migration safety**: Migration 006 updates existing rows (`SET pose = 'untagged' WHERE pose IS NULL`) before adding the NOT NULL constraint. If the table has data, this must run in a transaction.

5. **Cache invalidation**: The 5-minute TTL is a pragmatic choice for a pipeline that runs once or twice daily. For development, `clearSheetCache()` is exposed for tests.

6. **SceneScript.targetPose typing**: Adding `targetPose` to `SceneScript` is a breaking change to the interface. Since `writeScript` is stubbed, this is safe now, but any future consumers of `SceneScript` must handle the new field.
