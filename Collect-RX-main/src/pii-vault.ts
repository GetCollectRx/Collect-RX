/**
 * PIIVault — PHI Tokenization Layer
 *
 * CRITICAL SECURITY BOUNDARY:
 * This module is the single point through which all patient health information
 * passes before entering any AI/LLM/Vapi layer. PHI is replaced with UUID tokens.
 * Detokenization happens ONLY on the backend after call completion.
 *
 * Safe to send externally:  UUID tokens, claim numbers, CDT codes, dollar amounts, carrier names
 * NEVER send externally:    patient names, DOBs, subscriber IDs, health card numbers, group policy numbers
 *
 * PHIPA/PIPEDA compliance depends entirely on this boundary being respected.
 */

/**
 * @deprecated Use src/services/pii-vault.ts instead. This module stores full
 * PHI in process memory and should not be used for new code. The canonical
 * vault at services/pii-vault.ts stores only patientId→token mappings.
 */

import crypto from 'crypto';

export interface PatientPHI {
  patientName: string;
  dateOfBirth: string;
  subscriberId: string;
  groupPolicyNumber: string;
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

export interface VaultStats {
  activeTokens: number;
  expiredTokens: number;
  totalTokensIssued: number;
  oldestActiveToken: Date | null;
}

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_VAULT_SIZE = 10_000;

export class PIIVault {
  private readonly vault = new Map<string, VaultEntry>();
  private totalIssued = 0;

  tokenize(phi: PatientPHI, callerContext: string): string {
    this.enforceVaultLimit();
    const token = crypto.randomUUID();
    const now = new Date();
    this.vault.set(token, {
      token, phi,
      createdAt: now,
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
      accessLog: [{ action: 'tokenize', timestamp: now, callerContext }],
    });
    this.totalIssued++;
    return token;
  }

  detokenize(token: string, callerContext: string, ipAddress?: string): DetokenizeResult {
    const entry = this.vault.get(token);
    if (!entry) return { success: false, error: 'TOKEN_NOT_FOUND' };
    if (new Date() > entry.expiresAt) {
      this.expireToken(token, callerContext);
      return { success: false, error: 'TOKEN_EXPIRED' };
    }
    entry.accessLog.push({ action: 'detokenize', timestamp: new Date(), callerContext, ipAddress });
    return { success: true, phi: entry.phi };
  }

  expireToken(token: string, callerContext: string): void {
    const entry = this.vault.get(token);
    if (!entry) return;
    entry.accessLog.push({ action: 'expire', timestamp: new Date(), callerContext });
    this.vault.delete(token);
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
