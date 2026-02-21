-- Migration 005: Vendor health monitoring and sync queue

CREATE TABLE IF NOT EXISTS vendor_health_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy','degraded','down','unknown')),
  latency_ms INTEGER,
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS storage_sync_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('insert','update','delete')),
  record_data JSONB NOT NULL,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vendor_health_name_time ON vendor_health_log(vendor_name, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_health_recent ON vendor_health_log(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_queue_unsynced ON storage_sync_queue(created_at) WHERE synced_at IS NULL;

-- View: current vendor status (latest per vendor)
CREATE OR REPLACE VIEW current_vendor_health AS
SELECT DISTINCT ON (vendor_name)
  vendor_name, status, latency_ms, error_message, checked_at
FROM vendor_health_log
ORDER BY vendor_name, checked_at DESC;
