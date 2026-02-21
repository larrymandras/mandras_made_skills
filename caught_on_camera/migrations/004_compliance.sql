-- Migration 004: Compliance — publishing records, content flags, sensitivity pauses

-- ─── published_videos ────────────────────────────────────────────────────────
-- Per-platform publishing records with AI disclosure tracking
CREATE TABLE IF NOT EXISTS published_videos (
  id                       UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id                 UUID        NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  platform                 TEXT        NOT NULL
                             CHECK (platform IN ('youtube', 'shorts', 'tiktok', 'instagram')),
  platform_post_id         TEXT,                      -- platform's own video/post ID
  platform_url             TEXT,
  status                   TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'published', 'failed', 'taken_down')),
  -- AI disclosure / labeling compliance
  ai_disclosure_label      BOOLEAN     NOT NULL DEFAULT FALSE,  -- "AI-generated" label applied on platform
  ai_disclosure_caption    BOOLEAN     NOT NULL DEFAULT FALSE,  -- disclosure text in caption
  not_for_kids_flag        BOOLEAN     NOT NULL DEFAULT FALSE,
  -- publishing metadata
  published_at             TIMESTAMPTZ,
  taken_down_at            TIMESTAMPTZ,
  error_message            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (video_id, platform)
);

-- ─── content_flags ───────────────────────────────────────────────────────────
-- Any concern raised about a video — from automated gates or human review
CREATE TABLE IF NOT EXISTS content_flags (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id    UUID        NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  flag_type   TEXT        NOT NULL,    -- e.g. 'graphic_content', 'misinformation', 'copyright'
  flag_source TEXT        NOT NULL
                CHECK (flag_source IN ('gate', 'operator', 'platform', 'viewer')),
  description TEXT        NOT NULL,
  resolved    BOOLEAN     NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,                    -- operator ID or system handle
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── sensitivity_pauses ──────────────────────────────────────────────────────
-- Operator-controlled production halt for a category (e.g., after a real event)
CREATE TABLE IF NOT EXISTS sensitivity_pauses (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  category     TEXT        NOT NULL,   -- matches ring_cam_ideas.category or body_cam_ideas.category
  reason       TEXT        NOT NULL,
  paused_until TIMESTAMPTZ NOT NULL,
  created_by   TEXT        NOT NULL,   -- operator handle
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_published_videos_video       ON published_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_published_videos_platform    ON published_videos(platform, status);
CREATE INDEX IF NOT EXISTS idx_published_videos_status      ON published_videos(status);
CREATE INDEX IF NOT EXISTS idx_content_flags_video          ON content_flags(video_id);
CREATE INDEX IF NOT EXISTS idx_content_flags_resolved       ON content_flags(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_sensitivity_pauses_category  ON sensitivity_pauses(category);
CREATE INDEX IF NOT EXISTS idx_sensitivity_pauses_until     ON sensitivity_pauses(paused_until);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE published_videos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_flags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitivity_pauses  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access_published_videos"
  ON published_videos FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_full_access_content_flags"
  ON content_flags FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_full_access_sensitivity_pauses"
  ON sensitivity_pauses FOR ALL
  USING (auth.role() = 'service_role');
