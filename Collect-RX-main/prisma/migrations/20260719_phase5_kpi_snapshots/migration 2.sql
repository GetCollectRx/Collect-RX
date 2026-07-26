-- Phase 5 KPI Snapshots table for tracking CDCP reconsideration metrics over time
CREATE TABLE IF NOT EXISTS phase5_kpi_snapshots (
  id BIGSERIAL PRIMARY KEY,
  practice_id INTEGER NOT NULL,
  snapshot_date DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(practice_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_phase5_kpi_practice_date
  ON phase5_kpi_snapshots(practice_id, snapshot_date DESC);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_phase5_kpi_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_phase5_kpi_updated_at_trigger ON phase5_kpi_snapshots;

CREATE TRIGGER update_phase5_kpi_updated_at_trigger
  BEFORE UPDATE ON phase5_kpi_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION update_phase5_kpi_updated_at();
