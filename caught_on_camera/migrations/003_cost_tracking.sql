-- Migration 003: Cost tracking — per-video costs and daily spend aggregation

-- ─── costs ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS costs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id         UUID        REFERENCES videos(id) ON DELETE SET NULL,
  scene_id         UUID        REFERENCES scenes(id) ON DELETE SET NULL,
  veo_cost         NUMERIC(8, 4) NOT NULL DEFAULT 0,
  claude_cost      NUMERIC(8, 4) NOT NULL DEFAULT 0,
  cloudinary_cost  NUMERIC(8, 4) NOT NULL DEFAULT 0,
  total_cost       NUMERIC(8, 4) NOT NULL DEFAULT 0,
  veo_variant      TEXT        CHECK (veo_variant IN ('text-to-video', 'extend')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_total_matches
    CHECK (total_cost >= 0)
);

-- ─── daily_spend ─────────────────────────────────────────────────────────────
-- One row per calendar date; updated atomically on every cost insert
CREATE TABLE IF NOT EXISTS daily_spend (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  date             DATE        NOT NULL UNIQUE,
  veo_total        NUMERIC(10, 4) NOT NULL DEFAULT 0,
  claude_total     NUMERIC(10, 4) NOT NULL DEFAULT 0,
  cloudinary_total NUMERIC(10, 4) NOT NULL DEFAULT 0,
  grand_total      NUMERIC(10, 4) NOT NULL DEFAULT 0,
  video_count      INTEGER     NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_costs_video_id    ON costs(video_id);
CREATE INDEX IF NOT EXISTS idx_costs_scene_id    ON costs(scene_id);
CREATE INDEX IF NOT EXISTS idx_costs_created_at  ON costs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_spend_date  ON daily_spend(date DESC);

-- ─── Function: upsert daily_spend on cost insert ──────────────────────────────
-- Called by trigger on costs; accumulates spend into daily_spend for the
-- calendar date of the cost row.
CREATE OR REPLACE FUNCTION fn_update_daily_spend()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_date DATE := (NEW.created_at AT TIME ZONE 'UTC')::DATE;
BEGIN
  INSERT INTO daily_spend (date, veo_total, claude_total, cloudinary_total, grand_total, video_count, updated_at)
  VALUES (
    v_date,
    NEW.veo_cost,
    NEW.claude_cost,
    NEW.cloudinary_cost,
    NEW.total_cost,
    CASE WHEN NEW.video_id IS NOT NULL THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (date) DO UPDATE SET
    veo_total        = daily_spend.veo_total        + EXCLUDED.veo_total,
    claude_total     = daily_spend.claude_total     + EXCLUDED.claude_total,
    cloudinary_total = daily_spend.cloudinary_total + EXCLUDED.cloudinary_total,
    grand_total      = daily_spend.grand_total      + EXCLUDED.grand_total,
    video_count      = daily_spend.video_count      + EXCLUDED.video_count,
    updated_at       = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_costs_update_daily_spend
  AFTER INSERT ON costs
  FOR EACH ROW EXECUTE FUNCTION fn_update_daily_spend();

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE costs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access_costs"
  ON costs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_full_access_daily_spend"
  ON daily_spend FOR ALL
  USING (auth.role() = 'service_role');
