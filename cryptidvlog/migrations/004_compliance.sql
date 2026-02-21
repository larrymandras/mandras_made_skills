-- Migration 004: Compliance, GDPR, takedowns, and publishing records

CREATE TABLE IF NOT EXISTS gdpr_deletion_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_hash TEXT NOT NULL,
  request_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  tables_affected TEXT[],
  notes TEXT
);

CREATE TABLE IF NOT EXISTS takedown_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID REFERENCES videos(id),
  reason TEXT NOT NULL,
  requested_by TEXT,
  platform TEXT,
  platforms_removed TEXT[],
  audio_stripped BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS newsletter_signups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_hash TEXT NOT NULL UNIQUE,
  opted_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opted_out_at TIMESTAMPTZ,
  source TEXT
);

CREATE TABLE IF NOT EXISTS platform_publishes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES videos(id),
  platform TEXT NOT NULL CHECK (platform IN ('youtube','tiktok','instagram')),
  platform_video_id TEXT,
  platform_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed','taken_down')),
  synthetic_media_labeled BOOLEAN DEFAULT FALSE,
  not_for_kids_flag BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_publishes_video ON platform_publishes(video_id);
CREATE INDEX IF NOT EXISTS idx_platform_publishes_platform ON platform_publishes(platform, status);
CREATE INDEX IF NOT EXISTS idx_takedown_log_video ON takedown_log(video_id);
