import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { encryptPhiAtRest, decryptPhiAtRest } from '../src/server/crypto/phiAtRest';

describe('phiAtRest', () => {
  beforeEach(() => {
    process.env.PHI_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });

  afterEach(() => {
    delete process.env.PHI_ENCRYPTION_KEY;
  });

  it('encrypts and decrypts with PHI_CRYPTO_ACCESS audit lines (no plaintext in logs)', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      lines.push(String(msg));
    });

    const ctx = {
      recordId: 'pat-balance-uuid-1',
      fieldKey: 'patientPhone',
      practiceId: 'practice-uuid-2',
      actor: 'api:patientAr',
    };

    try {
      const blob = encryptPhiAtRest('+15551234567', ctx);
      const back = decryptPhiAtRest(blob, ctx);
      expect(back).toBe('+15551234567');

      const audit = lines.filter((l) => l.includes('PHI_CRYPTO_ACCESS'));
      expect(audit.length).toBeGreaterThanOrEqual(2);
      for (const line of audit) {
        const o = JSON.parse(line) as Record<string, unknown>;
        expect(o.msg).toBe('PHI_CRYPTO_ACCESS');
        expect(o.operation === 'encrypt' || o.operation === 'decrypt').toBe(true);
        expect(o.recordId).toBe('pat-balance-uuid-1');
        expect(String(line)).not.toContain('+1555');
        expect(String(line)).not.toContain(blob.encryptedText);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('logs decrypt failure without ciphertext', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      lines.push(String(msg));
    });

    const ctx = { recordId: 'r1', fieldKey: 'f1' };
    try {
      const blob = encryptPhiAtRest('data', ctx);
      process.env.PHI_ENCRYPTION_KEY = randomBytes(32).toString('hex');
      expect(() => decryptPhiAtRest(blob, ctx)).toThrow(/decrypt failed/);
      const failLine = lines.find((l) => l.includes('DECRYPT_FAILED'));
      expect(failLine).toBeDefined();
      expect(failLine).not.toContain('data');
    } finally {
      spy.mockRestore();
    }
  });
});
