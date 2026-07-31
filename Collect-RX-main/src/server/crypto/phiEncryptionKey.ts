// ─────────────────────────────────────────────────────────────────────────────
// AES-256 key material for PHI field encryption.
//
// Production: inject from AWS KMS / Azure Key Vault / GCP KMS / host secret manager
// (e.g. fly secrets populated from a vault). Never commit key material to git.
//
// Accepted formats for PHI_ENCRYPTION_KEY:
//   - 64 hex characters (32 bytes), or
//   - Standard base64 / base64url decoding to exactly 32 raw bytes
// ─────────────────────────────────────────────────────────────────────────────

const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * Parse 32-byte key from PHI_ENCRYPTION_KEY, or null if unset/invalid.
 */
export function parsePhiEncryptionKeyFromEnv(): Buffer | null {
  const raw = (process.env.PHI_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  if (HEX64.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    return null;
  }
  return null;
}

export function requirePhiEncryptionKey(): Buffer {
  const k = parsePhiEncryptionKeyFromEnv();
  if (!k) {
    throw new Error(
      '[phiEncryption] PHI_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes) ' +
        'or base64 that decodes to 32 bytes. Load from KMS / secret manager in production.',
    );
  }
  return k;
}

export function isPhiEncryptionAtRestEnabled(): boolean {
  const v = (process.env.PHI_ENCRYPTION_AT_REST || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * When PHI_ENCRYPTION_AT_REST is enabled in production, require a valid key at startup.
 */
export function assertPhiEncryptionAtRestConfigured(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!isPhiEncryptionAtRestEnabled()) return;
  assertValidPhiEncryptionKey(
    'PHI_ENCRYPTION_AT_REST is enabled in production',
  );
}

/**
 * Persisted vault entries are always encrypted. Production must have a valid
 * key before attaching the backing store or accepting any traffic.
 */
export function assertPersistentPhiVaultConfigured(): void {
  if (process.env.NODE_ENV !== 'production') return;
  assertValidPhiEncryptionKey('persisted PHI vault is enabled in production');
}

function assertValidPhiEncryptionKey(configuration: string): void {
  if (parsePhiEncryptionKeyFromEnv()) return;
  throw new Error(
    `[server] FATAL: ${configuration} but PHI_ENCRYPTION_KEY is missing or invalid. ` +
      'Set a 32-byte key from your KMS / secret manager. ' +
      'See docs/operations/DATA-ENCRYPTION.md.',
  );
}
