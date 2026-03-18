-- Migration 007: Guest character support
--
-- Adds role, display_name, and archetype columns to the characters table
-- so the system can distinguish lead characters from guest characters
-- and cast guests appropriately in the pipeline.

BEGIN;

-- Add role column to characters table
ALTER TABLE characters ADD COLUMN role TEXT NOT NULL DEFAULT 'lead' CHECK (role IN ('lead', 'guest'));

-- Update existing characters
UPDATE characters SET role = 'lead' WHERE name IN ('yeti', 'bigfoot');

-- Add display_name column for guest characters with proper names
ALTER TABLE characters ADD COLUMN display_name TEXT;

-- Add archetype column
ALTER TABLE characters ADD COLUMN archetype TEXT;

COMMIT;
