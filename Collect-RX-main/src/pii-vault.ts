/**
 * PIIVault — PHI Tokenization Layer
 *
 * PHI ARCHITECTURE:
 * This module is the single point through which all patient health information
 * passes. PHI is tokenized to UUID at import time. The token is the only
 * patient identifier stored in the DB. At call dispatch time the server
 * detokenizes to get real PHI, which is injected as EPHEMERAL Vapi call
 * variables only — never logged, never stored in DB, deleted from Vapi
 * after the call via handlePostCallAudioDeletion().
 *
 * Boundary:  PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY
 *
 * Safe to persist:  UUID tokens, claim numbers, CDT codes, dollar amounts
 * NEVER persist:    patient names, DOBs, subscriber IDs, health card numbers
 * Ephemeral only:   PHI injected as Vapi call variables, revoked post-call
 *
 * PHIPA/PIPEDA compliance depends on this boundary being respected.
 */

import crypto, { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { PrismaClient } from '@prisma/client';

// ── AES-256-GCM helpers for encrypted PHI persistence ────────────────────────
// Key material comes from PHI_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
// Same format accepted by src/server/crypto/phiEncryptionKey.ts.

const GCM_ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getPhiKey(): Buffer {
  const raw = (process.env.PHI_ENCRYPTION_KEY ?? '').trim();
  if (!raw) {
    throw new Error(
      '[PIIVault] PHI_ENCRYPTION_KEY is required for encrypted PHI persistence. ' +
        'Set to a 64-char hex string (32 bytes) from your secret manager.',
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) return b;
  } catch { /* fall through */ }
  throw new Error('[PIIVault] PHI_ENCRYPTION_KEY must be 64 hex chars or base64 decoding to 32 bytes');
}

function encryptPhi(phi: PatientPHI): { ciphertext: string; iv: string; authTag: string } {
  const key = getPhiKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(GCM_ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(phi), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: enc.toString('hex'), iv: iv.toString('hex'), authTag: tag.toString('hex') };
}

function decryptPhi(ciphertext: string, iv: string, authTag: string): PatientPHI {
  const key = getPhiKey();
  const decipher = createDecipheriv(GCM_ALGO, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex').slice(0, TAG_BYTES));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString('utf8')) as PatientPHI;
}

export interface PatientPHI {
  patientName: string;
  dateOfBirth: string;         // ISO date YYYY-MM-DD
  subscriberId: string;        // member/certificate number on the plan card
  groupPolicyNumber: string;   // employer group/plan number
  /// Name on the plan when the patient is a dependent. Required by some carriers
  /// when relationship !== 'self' (e.g. spouse, child) to authenticate the plan holder.
  subscriberName?: string;
  /// Date of birth of the plan subscriber — distinct from the patient's DOB when
  /// the patient is a dependent. Some carriers require this to pull the plan.
  subscriberDateOfBirth?: string; // ISO date YYYY-MM-DD
  healthCardNumber?: string;
}

export interface PatientToken {
  patientToken: string;
  claimNumber: string;
  carrierId: string;
  billedAmount: number;
  procedureCodes: string[];
  daysOutstanding: number;
}

interface VaultEntry {
  token: string;
  practiceId: string;
  phi: PatientPHI;
  createdAt: Date;
  expiresAt: Date;
  accessLog: VaultAccessLogEntry[];
}

interface VaultAccessLogEntry {
  action: 'tokenize' | 'detokenize' | 'expire' | 'audit_read';
  timestamp: Date;
  callerContext: string;
  ipAddress?: string;
}

export interface DetokenizeResult {
  success: boolean;
  phi?: PatientPHI;
  error?: string;
}

export type DetokenizeOptions = {
  practiceId: string;
  ipAddress?: string;
};

export interface VaultStats {
  activeTokens: number;
  expiredTokens: number;
  totalTokensIssued: number;
  oldestActiveToken: Date | null;
}

// PHI must outlive the claim it belongs to, not a wall-clock guess: claims
// legally wait 30+ days before their first call and automated recovery runs
// to day 90. A short TTL silently strands every claim whose token expires
// before its call — detokenize fails at dispatch forever. Entries are
// AES-256-GCM encrypted at rest (PhiVaultEntry) and purged by GC at expiry,
// so retention length does not change the storage security posture.
const TOKEN_TTL_MS =
  Math.max(1, Number(process.env.PHI_VAULT_TTL_DAYS || 120)) * 24 * 60 * 60 * 1000;
// With claim-lifecycle retention nothing expires quickly, so the cap must fit
// every active claim across all practices — at the cap, tokenize() throws.
const MAX_VAULT_SIZE = Math.max(1_000, Number(process.env.PHI_VAULT_MAX_TOKENS || 100_000));
// In-memory access log per token — the durable audit trail is logger.audit;
// this is a debugging aid and must not grow unboundedly over a token's life.
const MAX_ACCESS_LOG_ENTRIES = 50;

export class PIIVault {
  private readonly vault = new Map<string, VaultEntry>();
  private totalIssued = 0;
  private db: PrismaClient | null = null;

  /**
   * Attach a Prisma client so tokenize/expire also write to the encrypted
   * PhiVaultEntry table. Call this once on server boot before the queue engine starts.
   */
  useStore(prisma: PrismaClient): void {
    this.db = prisma;
  }

  tokenize(phi: PatientPHI, callerContext: string, practiceId: string): string {
    const tenantId = practiceId.trim();
    if (!tenantId) {
      throw new Error('[PIIVault] tokenize requires a non-empty practiceId');
    }
    this.enforceVaultLimit();
    const token = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
    this.vault.set(token, {
      token,
      practiceId: tenantId,
      phi,
      createdAt: now,
      expiresAt,
      accessLog: [{ action: 'tokenize', timestamp: now, callerContext }],
    });
    this.totalIssued++;
    // Persist to encrypted DB store (non-blocking — in-memory vault is the fast path)
    if (this.db) {
      this.persistToken(token, tenantId, phi, expiresAt).catch((err) => {
        console.error('[PIIVault] persist failed (non-fatal — token lives in memory):', err);
      });
    }
    return token;
  }

  /**
   * Resolve a token to PHI. Requires the caller's practiceId — tokens are
   * tenant-bound in memory and in phi_vault_entries.
   */
  detokenize(token: string, callerContext: string, options: DetokenizeOptions): DetokenizeResult {
    const practiceId = options.practiceId.trim();
    if (!practiceId) {
      return { success: false, error: 'PRACTICE_ID_REQUIRED' };
    }
    const entry = this.vault.get(token);
    if (!entry) return { success: false, error: 'TOKEN_NOT_FOUND' };
    if (entry.practiceId !== practiceId) {
      return { success: false, error: 'PRACTICE_MISMATCH' };
    }
    if (new Date() > entry.expiresAt) {
      this.expireToken(token, callerContext);
      return { success: false, error: 'TOKEN_EXPIRED' };
    }
    entry.accessLog.push({
      action: 'detokenize',
      timestamp: new Date(),
      callerContext,
      ipAddress: options.ipAddress,
    });
    if (entry.accessLog.length > MAX_ACCESS_LOG_ENTRIES) {
      entry.accessLog.splice(0, entry.accessLog.length - MAX_ACCESS_LOG_ENTRIES);
    }
    return { success: true, phi: entry.phi };
  }

  expireToken(token: string, callerContext: string): void {
    const entry = this.vault.get(token);
    if (!entry) return;
    entry.accessLog.push({ action: 'expire', timestamp: new Date(), callerContext });
    this.vault.delete(token);
    // Remove from persistent store (non-blocking)
    if (this.db) {
      this.deleteFromStore(token).catch((err) => {
        console.error('[PIIVault] delete from store failed (non-fatal):', err);
      });
    }
  }

  // ── Persistence methods (require useStore() to have been called) ────────────

  /**
   * Encrypt and write a token to the PhiVaultEntry table.
   * Called automatically by tokenize() when a store is attached.
   */
  async persistToken(token: string, practiceId: string, phi: PatientPHI, expiresAt: Date): Promise<void> {
    if (!this.db) throw new Error('[PIIVault] persistToken called without a store');
    const { ciphertext, iv, authTag } = encryptPhi(phi);
    await this.db.phiVaultEntry.upsert({
      where: { token },
      create: { token, practiceId, ciphertext, iv, authTag, expiresAt },
      update: { practiceId, ciphertext, iv, authTag, expiresAt },
    });
  }

  /**
   * Remove a token from the persistent store.
   * Called automatically by expireToken() when a store is attached.
   */
  async deleteFromStore(token: string): Promise<void> {
    if (!this.db) return;
    await this.db.phiVaultEntry.deleteMany({ where: { token } }).catch(() => { /* already gone */ });
  }

  /**
   * Load all non-expired PhiVaultEntry rows from DB, decrypt, and populate
   * the in-memory vault. Returns the number of tokens loaded.
   *
   * Call this on server boot, before startDeskQueueEngine(). Must have called
   * useStore(prisma) first. Any rows where decryption fails are skipped with
   * a warning (key rotation scenario) and deleted from the store.
   */
  async rehydrate(): Promise<number> {
    if (!this.db) throw new Error('[PIIVault] rehydrate called without a store');
    const now = new Date();
    const rows = await this.db.phiVaultEntry.findMany({
      where: { expiresAt: { gt: now } },
    });

    // Purge expired rows while we're at it
    await this.db.phiVaultEntry.deleteMany({ where: { expiresAt: { lte: now } } }).catch(() => {});

    let loaded = 0;
    for (const row of rows) {
      try {
        const phi = decryptPhi(row.ciphertext, row.iv, row.authTag);
        this.vault.set(row.token, {
          token: row.token,
          practiceId: row.practiceId,
          phi,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          accessLog: [{ action: 'tokenize', timestamp: row.createdAt, callerContext: 'rehydrate' }],
        });
        loaded++;
      } catch (err) {
        console.error(
          `[PIIVault] rehydrate: failed to decrypt token ${row.token} — skipping + deleting.`,
          err,
        );
        await this.deleteFromStore(row.token).catch(() => {});
      }
    }
    return loaded;
  }

  isValid(token: string): boolean {
    const entry = this.vault.get(token);
    if (!entry) return false;
    if (new Date() > entry.expiresAt) { this.expireToken(token, 'auto-gc'); return false; }
    return true;
  }

  getAuditLog(token: string, callerContext: string): VaultAccessLogEntry[] | null {
    const entry = this.vault.get(token);
    if (!entry) return null;
    entry.accessLog.push({ action: 'audit_read', timestamp: new Date(), callerContext });
    return [...entry.accessLog];
  }

  gc(): number {
    const now = new Date();
    let purged = 0;
    for (const [token, entry] of this.vault.entries()) {
      if (now > entry.expiresAt) { this.vault.delete(token); purged++; }
    }
    return purged;
  }

  stats(): VaultStats {
    const now = new Date();
    let activeTokens = 0, expiredTokens = 0;
    let oldestActiveToken: Date | null = null;
    for (const entry of this.vault.values()) {
      if (now > entry.expiresAt) { expiredTokens++; }
      else {
        activeTokens++;
        if (!oldestActiveToken || entry.createdAt < oldestActiveToken) oldestActiveToken = entry.createdAt;
      }
    }
    return { activeTokens, expiredTokens, totalTokensIssued: this.totalIssued, oldestActiveToken };
  }

  private enforceVaultLimit(): void {
    if (this.vault.size >= MAX_VAULT_SIZE) {
      const purged = this.gc();
      if (purged === 0 && this.vault.size >= MAX_VAULT_SIZE) {
        throw new Error(`PIIVault capacity exceeded (${MAX_VAULT_SIZE} active tokens). Token leak detected.`);
      }
    }
  }
}

export const piiVault = new PIIVault();
