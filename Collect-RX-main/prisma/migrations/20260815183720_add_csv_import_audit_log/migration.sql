-- CSV Import Audit Log
-- Tracks all CSV imports for security and compliance purposes
-- Stores file hash (SHA-256) for integrity verification
-- Logs validation errors and import status

CREATE TABLE csv_import_logs (
  id SERIAL PRIMARY KEY,
  practice_id TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  row_count INT NOT NULL,
  error_count INT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'success',
  error_details TEXT,
  imported_by TEXT NOT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ip_address INET,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for practice lookups and status filtering
CREATE INDEX idx_csv_imports_practice_id ON csv_import_logs(practice_id);
CREATE INDEX idx_csv_imports_status ON csv_import_logs(status);
CREATE INDEX idx_csv_imports_imported_by ON csv_import_logs(imported_by);
CREATE INDEX idx_csv_imports_imported_at ON csv_import_logs(imported_at DESC);

-- Unique constraint on file hash to detect duplicate imports
CREATE UNIQUE INDEX idx_csv_imports_file_hash ON csv_import_logs(file_hash);

-- Add foreign key constraints
ALTER TABLE csv_import_logs
ADD CONSTRAINT fk_csv_imports_practice_id
FOREIGN KEY (practice_id) REFERENCES "Practice"(id) ON DELETE CASCADE;

ALTER TABLE csv_import_logs
ADD CONSTRAINT fk_csv_imports_imported_by
FOREIGN KEY (imported_by) REFERENCES "User"(id) ON DELETE SET NULL;

-- Comments for documentation
COMMENT ON TABLE csv_import_logs IS 'Security audit log for CSV imports - tracks file integrity, validation status, and import history';
COMMENT ON COLUMN csv_import_logs.file_hash IS 'SHA-256 hash for integrity verification and duplicate detection';
COMMENT ON COLUMN csv_import_logs.status IS 'Import status: success, partial, quarantined (suspicious/malformed)';
COMMENT ON COLUMN csv_import_logs.error_details IS 'JSON array of validation errors (first 50 only)';
