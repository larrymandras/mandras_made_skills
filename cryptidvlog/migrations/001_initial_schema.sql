-- Migration 001: Core video pipeline tables
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  concept_title TEXT NOT NULL,
  hook TEXT NOT NULL,
  scene_count INTEGER NOT NULL DEFAULT 0,
  character_focus TEXT NOT NULL CHECK (character_focus IN ('yeti', 'bigfoot', 'both')),
  status TEXT NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating','gates_passed','pending_review','approved','rejected','published','taken_down','failed')),
  ab_group TEXT CHECK (ab_group IN ('base','variant_a')),
  ab_parent_id UUID REFERENCES videos(id),
  total_cost_usd DECIMAL(8,4) DEFAULT 0,
  gate_scores JSONB DEFAULT '{}',
  rejection_reason TEXT,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  taken_down_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scenes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  scene_index INTEGER NOT NULL,
  script TEXT NOT NULL,
  narration TEXT,
  video_path TEXT,
  audio_path TEXT,
  duration_seconds DECIMAL(6,2),
  gate1_score INTEGER,
  gate2_pass BOOLEAN,
  gate3_pass BOOLEAN,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','generated','gates_passed','degraded','failed')),
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ab_test_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  base_video_id UUID NOT NULL REFERENCES videos(id),
  variant_video_id UUID NOT NULL REFERENCES videos(id),
  winning_video_id UUID REFERENCES videos(id),
  metric TEXT NOT NULL,
  base_value DECIMAL(10,4),
  variant_value DECIMAL(10,4),
  concluded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS concept_injection_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  concept_title TEXT NOT NULL,
  hook TEXT NOT NULL,
  setting TEXT,
  character_focus TEXT,
  priority INTEGER DEFAULT 0,
  ab_eligible BOOLEAN DEFAULT FALSE,
  ab_priority_score INTEGER DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','used','skipped')),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenes_video_id ON scenes(video_id);
CREATE INDEX IF NOT EXISTS idx_concept_queue_status ON concept_injection_queue(status, priority DESC);
