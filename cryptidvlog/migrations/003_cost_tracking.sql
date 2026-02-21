-- Migration 003: Cost tracking and storage management

CREATE TABLE IF NOT EXISTS scene_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  vendor TEXT NOT NULL,
  operation TEXT NOT NULL,
  cost_usd DECIMAL(8,4) NOT NULL DEFAULT 0,
  tokens_used INTEGER,
  duration_seconds DECIMAL(8,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  total_cost_usd DECIMAL(8,4) NOT NULL DEFAULT 0,
  video_gen_cost_usd DECIMAL(8,4) DEFAULT 0,
  voice_cost_usd DECIMAL(8,4) DEFAULT 0,
  ai_cost_usd DECIMAL(8,4) DEFAULT 0,
  ab_variant_cost_usd DECIMAL(8,4) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_budget_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL,
  total_cost_usd DECIMAL(8,4) NOT NULL DEFAULT 0,
  video_count INTEGER DEFAULT 0,
  ab_count INTEGER DEFAULT 0,
  cap_hit BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(date)
);

CREATE TABLE IF NOT EXISTS storage_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID REFERENCES videos(id),
  scene_id UUID REFERENCES scenes(id),
  file_type TEXT NOT NULL CHECK (file_type IN ('scene_clip','final_video','audio','thumbnail','reference_frame')),
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT,
  retained_until DATE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_budget_date ON daily_budget_log(date);
CREATE INDEX IF NOT EXISTS idx_scene_costs_scene ON scene_costs(scene_id);
CREATE INDEX IF NOT EXISTS idx_video_costs_video ON video_costs(video_id);
CREATE INDEX IF NOT EXISTS idx_storage_files_video ON storage_files(video_id);
CREATE INDEX IF NOT EXISTS idx_storage_files_retained ON storage_files(retained_until) WHERE deleted_at IS NULL;
