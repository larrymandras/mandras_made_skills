-- Migration 002: Character system tables

CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  species TEXT NOT NULL,
  height_ft_min DECIMAL(4,1),
  height_ft_max DECIMAL(4,1),
  fur_color TEXT,
  eye_color TEXT,
  voice_hz_min INTEGER,
  voice_hz_max INTEGER,
  personality TEXT,
  backstory TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed character data
INSERT INTO characters (name, species, height_ft_min, height_ft_max, fur_color, eye_color, voice_hz_min, voice_hz_max, personality, backstory)
VALUES
  ('yeti', 'Himalayan Yeti', 8.0, 9.0, 'white/silver', 'blue-grey', 170, 290,
   'Anxious tech enthusiast, conspiracy-prone, easily startled by own shadow',
   'Former mountain monk who discovered WiFi in 2019 and has not recovered since'),
  ('bigfoot', 'North American Sasquatch', 7.0, 8.0, 'dark brown', 'amber', 80, 180,
   'Laid-back Pacific Northwest outdoorsman, skeptical of technology, excellent with plants',
   'Has lived in the PNW for 400+ years and has strong opinions about artisanal coffee')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS character_consistency_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  details JSONB DEFAULT '{}',
  saved_as_reference BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS character_reference_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','auto_extracted')),
  version INTEGER NOT NULL DEFAULT 1,
  pose TEXT,
  file_path TEXT NOT NULL,
  consistency_score INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS character_interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES videos(id),
  episode_number INTEGER,
  characters TEXT[] NOT NULL,
  summary TEXT NOT NULL,
  callbacks TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS character_ip_registry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_name TEXT NOT NULL,
  ip_type TEXT NOT NULL CHECK (ip_type IN ('trademark','copyright','patent','other')),
  owner TEXT,
  description TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','blocked')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consistency_scores_character ON character_consistency_scores(character_name, score);
CREATE INDEX IF NOT EXISTS idx_reference_images_character ON character_reference_images(character_name, is_active);
CREATE INDEX IF NOT EXISTS idx_interactions_video ON character_interactions(video_id);
