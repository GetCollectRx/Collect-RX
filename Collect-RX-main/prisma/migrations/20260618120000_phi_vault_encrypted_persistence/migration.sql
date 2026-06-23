-- Migration: 20260618120000_phi_vault_encrypted_persistence
--
-- Creates phi_vault_entries — the encrypted persistence layer for PIIVault.
--
-- Each row stores one patientToken → PatientPHI mapping encrypted with
-- AES-256-GCM (PHI_ENCRYPTION_KEY). On server restart, rehydrate() decrypts
-- all live rows back into the in-memory vault so the queue engine can dispatch
-- claims without requiring a re-import of PHI from CSV.
--
-- PHIPA/PIPEDA: this table contains ENCRYPTED PHI. Never decrypt except in
-- piiVault.rehydrate() and piiVault.persistToken(). Never select raw rows
-- outside of the PIIVault class. Audit every access.

CREATE TABLE "phi_vault_entries" (
  "token"      TEXT        NOT NULL,
  "ciphertext" TEXT        NOT NULL,   -- AES-256-GCM ciphertext, hex-encoded
  "iv"         TEXT        NOT NULL,   -- 12-byte random IV, hex-encoded
  "auth_tag"   TEXT        NOT NULL,   -- 16-byte GCM auth tag, hex-encoded
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "phi_vault_entries_pkey" PRIMARY KEY ("token")
);

-- Index to support purge of expired entries on boot and hourly GC
CREATE INDEX "phi_vault_entries_expires_at_idx" ON "phi_vault_entries" ("expires_at");

-- Row-level comment (documentation; no data effect)
COMMENT ON TABLE "phi_vault_entries" IS
  'AES-256-GCM encrypted PHI backing store. Keyed by patientToken UUID. '
  'Never query this table directly — use piiVault.rehydrate() only. '
  'PHI_ENCRYPTION_KEY required. PHIPA-sensitive.';
