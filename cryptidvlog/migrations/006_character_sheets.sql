-- Migration 006: Character sheet support and pose tagging enforcement
--
-- Adds sheet_version, sheet_yaml, and sheet_updated_at to the characters table
-- so each character can carry a versioned YAML character sheet. Also enforces
-- the pose column on character_reference_images: backfills NULLs to 'untagged',
-- sets NOT NULL + default, and adds a CHECK constraint restricting pose values
-- to a known set. Finally adds a composite index for pose-based lookups.

BEGIN;

-- 1. Add character sheet columns to characters table
ALTER TABLE characters ADD COLUMN sheet_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN sheet_yaml TEXT;
ALTER TABLE characters ADD COLUMN sheet_updated_at TIMESTAMPTZ;

-- 2. Fix character_reference_images.pose: backfill, enforce NOT NULL, set default
UPDATE character_reference_images SET pose = 'untagged' WHERE pose IS NULL;
ALTER TABLE character_reference_images ALTER COLUMN pose SET NOT NULL;
ALTER TABLE character_reference_images ALTER COLUMN pose SET DEFAULT 'untagged';

-- 3. Add check constraint for valid pose values
ALTER TABLE character_reference_images
ADD CONSTRAINT chk_pose_valid
CHECK (pose IN ('front', 'three-quarter', 'profile', 'back',
                'action-running', 'action-talking', 'close-up-face',
                'environment', 'action-standing', 'emotion-expressive',
                'untagged'));

-- 4. Index for pose-based lookups
CREATE INDEX IF NOT EXISTS idx_reference_images_pose
ON character_reference_images(character_name, pose, is_active);

COMMIT;
