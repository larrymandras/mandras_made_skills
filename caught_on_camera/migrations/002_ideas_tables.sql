-- Migration 002: Ideas tables — ring cam and body cam idea queues

-- ─── ring_cam_ideas ───────────────────────────────────────────────────────────
-- Ideas for static / doorbell / security-cam style content
CREATE TABLE IF NOT EXISTS ring_cam_ideas (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title             TEXT        NOT NULL,
  hook              TEXT        NOT NULL,      -- first 3 seconds hook
  scenario          TEXT        NOT NULL,
  category          TEXT        NOT NULL
                      CHECK (category IN ('animals', 'paranormal', 'delivery', 'weather', 'wholesome', 'fails', 'night_shift')),
  camera_position   TEXT        NOT NULL,      -- e.g. "porch, angled down 30°"
  time_of_day       TEXT        NOT NULL,      -- e.g. "2am", "golden hour"
  audio_notes       TEXT,
  virality_score    INTEGER     NOT NULL CHECK (virality_score BETWEEN 1 AND 10),
  virality_elements TEXT[]      NOT NULL DEFAULT '{}',
  format_type       TEXT        NOT NULL DEFAULT 'single'
                      CHECK (format_type IN ('single', 'compilation')),
  compilation_theme TEXT,                      -- populated when format_type = 'compilation'
  caption           TEXT        NOT NULL,
  hashtags          TEXT[]      NOT NULL DEFAULT '{}',
  status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'in_production', 'produced', 'disabled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── body_cam_ideas ───────────────────────────────────────────────────────────
-- Ideas for first-person / wearable / vehicle camera style content
CREATE TABLE IF NOT EXISTS body_cam_ideas (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title             TEXT        NOT NULL,
  hook              TEXT        NOT NULL,
  scenario          TEXT        NOT NULL,
  category          TEXT        NOT NULL
                      CHECK (category IN ('encounter', 'pursuit', 'discovery', 'weather_nature', 'night_ops', 'response', 'dashcam_chaos')),
  cam_sub_type      TEXT        NOT NULL
                      CHECK (cam_sub_type IN ('police_security', 'hiker_trail', 'dashcam', 'helmet_action')),
  movement_notes    TEXT,                      -- camera motion: "running", "mounted, vibration", etc.
  time_of_day       TEXT        NOT NULL,
  audio_notes       TEXT,
  virality_score    INTEGER     NOT NULL CHECK (virality_score BETWEEN 1 AND 10),
  virality_elements TEXT[]      NOT NULL DEFAULT '{}',
  format_type       TEXT        NOT NULL DEFAULT 'single'
                      CHECK (format_type IN ('single', 'compilation')),
  compilation_theme TEXT,
  caption           TEXT        NOT NULL,
  hashtags          TEXT[]      NOT NULL DEFAULT '{}',
  status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'in_production', 'produced', 'disabled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ring_cam_ideas_status         ON ring_cam_ideas(status);
CREATE INDEX IF NOT EXISTS idx_ring_cam_ideas_category       ON ring_cam_ideas(category);
CREATE INDEX IF NOT EXISTS idx_ring_cam_ideas_virality       ON ring_cam_ideas(virality_score DESC);
CREATE INDEX IF NOT EXISTS idx_ring_cam_ideas_status_vir     ON ring_cam_ideas(status, virality_score DESC);
CREATE INDEX IF NOT EXISTS idx_ring_cam_ideas_created_at     ON ring_cam_ideas(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_body_cam_ideas_status         ON body_cam_ideas(status);
CREATE INDEX IF NOT EXISTS idx_body_cam_ideas_category       ON body_cam_ideas(category);
CREATE INDEX IF NOT EXISTS idx_body_cam_ideas_cam_sub_type   ON body_cam_ideas(cam_sub_type);
CREATE INDEX IF NOT EXISTS idx_body_cam_ideas_virality       ON body_cam_ideas(virality_score DESC);
CREATE INDEX IF NOT EXISTS idx_body_cam_ideas_status_vir     ON body_cam_ideas(status, virality_score DESC);
CREATE INDEX IF NOT EXISTS idx_body_cam_ideas_created_at     ON body_cam_ideas(created_at DESC);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE ring_cam_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_cam_ideas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access_ring_cam_ideas"
  ON ring_cam_ideas FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_full_access_body_cam_ideas"
  ON body_cam_ideas FOR ALL
  USING (auth.role() = 'service_role');
