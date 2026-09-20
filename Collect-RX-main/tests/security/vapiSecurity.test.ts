import { describe, it, expect, beforeAll } from 'vitest';
import {
  encryptVapiPayload,
  decryptVapiPayload,
  generateVapiEncryptionKey,
  isVapiCallsEnabled,
  validateVapiSecurityConfiguration,
} from '../../src/server/vapi/vapiSecurityControls.js';

describe('Vapi Security Controls', () => {
  beforeAll(() => {
    // Set a test encryption key
    const testKey = generateVapiEncryptionKey();
    process.env.VAPI_WEBHOOK_ENCRYPTION_KEY = testKey;
  });

  describe('Encryption', () => {
    it('encrypts and decrypts webhook payloads', () => {
      const payload = {
        callId: 'call_123',
        claimId: 'claim_456',
        status: 'completed',
        duration: 300,
        patientName: 'John Doe',
        timestamp: '2026-08-15T10:30:00Z',
      };

      // Encrypt
      const encrypted = encryptVapiPayload(payload);

      expect(encrypted.encrypted).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();

      // Encrypted data should not contain original values
      expect(encrypted.encrypted).not.toContain('John Doe');
      expect(encrypted.encrypted).not.toContain('call_123');

      // Decrypt
      const decrypted = decryptVapiPayload(encrypted.encrypted, encrypted.iv, encrypted.authTag);

      // Verify decrypted data matches original
      expect(decrypted.callId).toBe(payload.callId);
      expect(decrypted.claimId).toBe(payload.claimId);
      expect(decrypted.patientName).toBe(payload.patientName);
    });

    it('fails to decrypt with wrong key', () => {
      const payload = { secret: 'confidential_data', timestamp: new Date().toISOString() };

      // Encrypt with one key
      const encrypted = encryptVapiPayload(payload);

      // Simulate wrong key
      const wrongKey = generateVapiEncryptionKey();
      process.env.VAPI_WEBHOOK_ENCRYPTION_KEY = wrongKey;

      // Attempt to decrypt with wrong key should fail
      expect(() => {
        decryptVapiPayload(encrypted.encrypted, encrypted.iv, encrypted.authTag);
      }).toThrow();
    });

    it('handles large payloads', () => {
      const testKey = generateVapiEncryptionKey();
      process.env.VAPI_WEBHOOK_ENCRYPTION_KEY = testKey;

      const largePayload = {
        transcript: 'X'.repeat(10000),
        metadata: Array.from({ length: 100 }, (_, i) => ({
          index: i,
          value: `value_${i}`,
        })),
      };

      const encrypted = encryptVapiPayload(largePayload);
      const decrypted = decryptVapiPayload(encrypted.encrypted, encrypted.iv, encrypted.authTag);

      expect(decrypted.transcript).toBe(largePayload.transcript);
      expect((decrypted.metadata as any).length).toBe(100);
    });
  });

  describe('Configuration Validation', () => {
    it('validates Vapi security configuration', () => {
      const validation = validateVapiSecurityConfiguration();

      expect(validation).toHaveProperty('valid');
      expect(validation).toHaveProperty('warnings');
      expect(Array.isArray(validation.warnings)).toBe(true);
    });

    it('checks encryption key length', () => {
      const originalKey = process.env.VAPI_WEBHOOK_ENCRYPTION_KEY;
      process.env.VAPI_WEBHOOK_ENCRYPTION_KEY = 'short';

      const validation = validateVapiSecurityConfiguration();

      expect(validation.warnings.some((w) => w.includes('invalid length'))).toBe(true);

      process.env.VAPI_WEBHOOK_ENCRYPTION_KEY = originalKey;
    });
  });

  describe('Vapi Status', () => {
    it('checks if Vapi calls are enabled', () => {
      const originalEnabled = process.env.VAPI_ENABLED;

      process.env.VAPI_ENABLED = 'true';
      expect(isVapiCallsEnabled()).toBe(true);

      process.env.VAPI_ENABLED = 'false';
      expect(isVapiCallsEnabled()).toBe(false);

      if (originalEnabled !== undefined) {
        process.env.VAPI_ENABLED = originalEnabled;
      } else {
        delete process.env.VAPI_ENABLED;
      }
    });
  });

  describe('Key Generation', () => {
    it('generates valid encryption keys', () => {
      const key1 = generateVapiEncryptionKey();
      const key2 = generateVapiEncryptionKey();

      expect(key1).toMatch(/^[a-f0-9]{64}$/);
      expect(key2).toMatch(/^[a-f0-9]{64}$/);
      expect(key1).not.toBe(key2);
    });

    it('generated key works for encryption', () => {
      const key = generateVapiEncryptionKey();
      process.env.VAPI_WEBHOOK_ENCRYPTION_KEY = key;

      const payload = { test: 'data' };
      const encrypted = encryptVapiPayload(payload);
      const decrypted = decryptVapiPayload(encrypted.encrypted, encrypted.iv, encrypted.authTag);

      expect(decrypted.test).toBe('data');
    });
  });
});
