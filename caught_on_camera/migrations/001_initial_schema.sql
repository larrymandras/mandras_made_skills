-- Migration 001: Core pipeline tables for Caught on Camera
-- Security/body camera found-footage AI content system
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── videos ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS videos (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  idea_id              UUID        NOT NULL,
  idea_source          TEXT        NOT NULL CHECK (idea_source IN ('ring_cam', 'body_cam')),
  compilation_id       UUID,                    -- nullable: set when part of a compilation
  format               TEXT        NOT NULL CHECK (format IN ('ring_cam', 'body_cam')),
  cam_sub_type         TEXT        CHECK (cam_sub_type IN ('police_security', 'hiker_trail', 'dashcam', 'helmet_action')),
  master_16x9_url      TEXT        NOT NULL,
  vertical_9x16_url    TEXT,
  cloudinary_public_id TEXT        NOT NULL,
  title                TEXT        NOT NULL,
  caption              TEXT        NOT NULL,
  hashtags             TEXT[]      NOT NULL DEFAULT '{}',
  approval_status      TEXT        NOT NULL DEFAULT 'pending_review'
                         CHECK (approval_status IN ('pending_review', 'approved', 'rejected', 'published', 'taken_down')),
  reject_reason        TEXT,
  youtube_post_id      TEXT,
  shorts_post_id       TEXT,
  tiktok_post_id       TEXT,
  instagram_post_id    TEXT,
  crop_safe            BOOLEAN     NOT NULL DEFAULT TRUE,
  gate_results         JSONB       NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── scenes ──────────────────────────────────────────────────────────────────
-- Individual generated clips before they are assembled into a video
CREATE TABLE IF NOT EXISTS scenes (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  idea_id            UUID        NOT NULL,
  idea_source        TEXT        NOT NULL CHECK (idea_source IN ('ring_cam', 'body_cam')),
  format             TEXT        NOT NULL CHECK (format IN ('ring_cam', 'body_cam')),
  veo_prompt         TEXT        NOT NULL,
  raw_video_url      TEXT,
  degraded_video_url TEXT,        -- after lens-artifact / grain degradation pass
  overlaid_video_url TEXT,        -- after overlay (timestamp, UI chrome) pass
  cloudinary_url     TEXT,
  generation_cost    NUMERIC(8, 4),
  quality_score      INTEGER     CHECK (quality_score BETWEEN 0 AND 100),
  gate_pass          BOOLEAN,
  gate_failures      TEXT[]      NOT NULL DEFAULT '{}',
  retry_count        INTEGER     NOT NULL DEFAULT 0,
  status             TEXT        NOT NULL DEFAULT 'generating'
                       CHECK (status IN ('generating', 'gate_check', 'passed', 'failed', 'rejected')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── compilations ────────────────────────────────────────────────────────────
-- Multi-clip compilations assembled from individual scenes / videos
CREATE TABLE IF NOT EXISTS compilations (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  theme            TEXT        NOT NULL,
  title            TEXT        NOT NULL,
  format           TEXT        NOT NULL CHECK (format IN ('ring_cam', 'body_cam')),
  scene_ids        UUID[]      NOT NULL DEFAULT '{}',
  transition_style TEXT        NOT NULL DEFAULT 'cut',
  status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'ready', 'published')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── scripts ─────────────────────────────────────────────────────────────────
-- Structured Veo prompt scripts before they become scenes
CREATE TABLE IF NOT EXISTS scripts (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  idea_id          UUID        NOT NULL,
  idea_source      TEXT        NOT NULL CHECK (idea_source IN ('ring_cam', 'body_cam')),
  format           TEXT        NOT NULL CHECK (format IN ('ring_cam', 'body_cam')),
  cam_sub_type     TEXT,
  camera_spec_block TEXT       NOT NULL,   -- focal length, sensor noise, etc.
  environment_block TEXT       NOT NULL,   -- location, lighting, time of day
  action_block     TEXT        NOT NULL,   -- what happens in the clip
  audio_block      TEXT        NOT NULL,   -- diegetic sound design notes
  full_prompt      TEXT        NOT NULL,   -- concatenated final Veo prompt
  overlay_type     TEXT,                   -- e.g. 'ring_cam_ui', 'body_cam_hud'
  overlay_config   JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_videos_approval_status  ON videos(approval_status);
CREATE INDEX IF NOT EXISTS idx_videos_format           ON videos(format);
CREATE INDEX IF NOT EXISTS idx_videos_idea_id          ON videos(idea_id);
CREATE INDEX IF NOT EXISTS idx_videos_created_at       ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenes_idea_id          ON scenes(idea_id);
CREATE INDEX IF NOT EXISTS idx_scenes_status           ON scenes(status);
CREATE INDEX IF NOT EXISTS idx_scenes_gate_pass        ON scenes(gate_pass);
CREATE INDEX IF NOT EXISTS idx_compilations_status     ON compilations(status);
CREATE INDEX IF NOT EXISTS idx_scripts_idea_id         ON scripts(idea_id);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE videos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE compilations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripts       ENABLE ROW LEVEL SECURITY;

-- Service role (backend) has full access; anon role is blocked by default.
CREATE POLICY "service_full_access_videos"
  ON videos FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_full_access_scenes"
  ON scenes FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_full_access_compilations"
  ON compilations FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_full_access_scripts"
  ON scripts FOR ALL
  USING (auth.role() = 'service_role');

-- ─── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
