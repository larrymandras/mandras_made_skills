-- Migration 005: Platform analytics — engagement tracking and suppression detection

-- ─── analytics ───────────────────────────────────────────────────────────────
-- Snapshots of engagement metrics fetched from each platform
CREATE TABLE IF NOT EXISTS analytics (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id         UUID        NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  platform         TEXT        NOT NULL
                     CHECK (platform IN ('youtube', 'shorts', 'tiktok', 'instagram')),
  views            INTEGER     NOT NULL DEFAULT 0,
  likes            INTEGER     NOT NULL DEFAULT 0,
  shares           INTEGER     NOT NULL DEFAULT 0,
  comments         INTEGER     NOT NULL DEFAULT 0,
  completion_rate  NUMERIC(5, 4),          -- 0.0–1.0 fraction of viewers who watched to end
  format           TEXT        NOT NULL CHECK (format IN ('ring_cam', 'body_cam')),
  posted_at        TIMESTAMPTZ NOT NULL,   -- when the video went live on the platform
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── platform_health ─────────────────────────────────────────────────────────
-- Periodic suppression / reach health snapshot per platform
CREATE TABLE IF NOT EXISTS platform_health (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform             TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'normal'
                         CHECK (status IN ('normal', 'warning', 'critical')),
  recent_avg_views     NUMERIC(12, 2),     -- avg views over look-back window
  historical_avg_views NUMERIC(12, 2),     -- baseline avg views (90-day)
  suppression_ratio    NUMERIC(6, 4),      -- recent / historical; < 0.5 triggers warning
  checked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_analytics_video_id    ON analytics(video_id);
CREATE INDEX IF NOT EXISTS idx_analytics_platform    ON analytics(platform);
CREATE INDEX IF NOT EXISTS idx_analytics_format      ON analytics(format);
CREATE INDEX IF NOT EXISTS idx_analytics_posted_at   ON analytics(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_checked_at  ON analytics(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_health_plat  ON platform_health(platform, checked_at DESC);

-- ─── View: 30-day average suppression detection ───────────────────────────────
-- For each video × platform, compare the latest snapshot views against the
-- 30-day rolling average for that platform. Rows where the ratio < 0.5 are
-- flagged as potentially suppressed.
CREATE OR REPLACE VIEW suppression_alerts AS
WITH recent AS (
  SELECT
    a.platform,
    a.video_id,
    a.views,
    a.checked_at,
    ROW_NUMBER() OVER (PARTITION BY a.video_id, a.platform ORDER BY a.checked_at DESC) AS rn
  FROM analytics a
),
latest AS (
  SELECT platform, video_id, views, checked_at
  FROM recent
  WHERE rn = 1
),
rolling_avg AS (
  SELECT
    platform,
    AVG(views)::NUMERIC(12, 2) AS avg_views_30d
  FROM analytics
  WHERE checked_at >= NOW() - INTERVAL '30 days'
  GROUP BY platform
)
SELECT
  l.video_id,
  l.platform,
  l.views           AS latest_views,
  r.avg_views_30d,
  CASE
    WHEN r.avg_views_30d > 0
    THEN ROUND(l.views / r.avg_views_30d, 4)
    ELSE NULL
  END               AS suppression_ratio,
  CASE
    WHEN r.avg_views_30d > 0 AND (l.views / r.avg_views_30d) < 0.5
    THEN TRUE
    ELSE FALSE
  END               AS suppressed,
  l.checked_at
FROM latest l
JOIN rolling_avg r USING (platform);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE analytics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access_analytics"
  ON analytics FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_full_access_platform_health"
  ON platform_health FOR ALL
  USING (auth.role() = 'service_role');
