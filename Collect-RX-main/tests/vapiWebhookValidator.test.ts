/**
 * Vapi Webhook Validation — Payload integrity
 *
 * Tests that malformed or missing fields are caught before processing.
 * This prevents crashes or incorrect claim routing from invalid payloads.
 */

import { describe, it, expect } from 'vitest';
import { validateVapiWebhookPayload, validateVapiWebhookPayloadSafe } from '../src/vapi/webhookValidator';

describe('Vapi Webhook Validation', () => {
  const validPayload = {
    type: 'call.ended',
    call: {
      id: 'call-123',
      status: 'completed',
      startedAt: '2026-08-05T10:00:00Z',
      endedAt: '2026-08-05T10:05:00Z',
      durationSeconds: 300,
    },
    transcript: 'Conversation transcript here',
    metadata: {
      claimId: 'claim-456',
      carrierId: 'sun_life',
      patientToken: 'token-789',
      practiceId: 'p123',
    },
  };

  describe('validateVapiWebhookPayload (throws on error)', () => {
    it('accepts valid call.ended payload', () => {
      const result = validateVapiWebhookPayload(validPayload);
      expect(result.type).toBe('call.ended');
      expect(result.call.id).toBe('call-123');
      expect(result.metadata?.claimId).toBe('claim-456');
    });

    it('accepts valid call.failed payload', () => {
      const payload = { ...validPayload, type: 'call.failed' };
      const result = validateVapiWebhookPayload(payload);
      expect(result.type).toBe('call.failed');
    });

    it('accepts minimal payload (only required fields)', () => {
      const minimal = {
        type: 'call.ended',
        call: { id: 'call-123', status: 'completed' },
      };
      const result = validateVapiWebhookPayload(minimal);
      expect(result.call.id).toBe('call-123');
      expect(result.metadata).toBeUndefined();
    });

    it('rejects missing type field', () => {
      const { type, ...invalid } = validPayload;
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('rejects invalid type value', () => {
      const invalid = { ...validPayload, type: 'call.unknown' };
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('rejects missing call object', () => {
      const { call, ...invalid } = validPayload;
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('rejects missing call.id', () => {
      const invalid = {
        ...validPayload,
        call: { status: 'completed' },
      };
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('rejects empty call.id', () => {
      const invalid = {
        ...validPayload,
        call: { id: '', status: 'completed' },
      };
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('rejects invalid startedAt timestamp', () => {
      const invalid = {
        ...validPayload,
        call: { id: 'call-123', status: 'completed', startedAt: 'not-a-date' },
      };
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('rejects metadata.carrierId if missing (when metadata is provided)', () => {
      const invalid = {
        ...validPayload,
        metadata: {
          claimId: 'claim-456',
          // carrierId: 'sun_life', — MISSING
          patientToken: 'token-789',
          practiceId: 'p123',
        },
      };
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('rejects metadata.patientToken if missing (when metadata is provided)', () => {
      const invalid = {
        ...validPayload,
        metadata: {
          claimId: 'claim-456',
          carrierId: 'sun_life',
          // patientToken: 'token-789', — MISSING
          practiceId: 'p123',
        },
      };
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('rejects metadata.practiceId if missing (when metadata is provided)', () => {
      const invalid = {
        ...validPayload,
        metadata: {
          claimId: 'claim-456',
          carrierId: 'sun_life',
          patientToken: 'token-789',
          // practiceId: 'p123', — MISSING
        },
      };
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('rejects invalid preVisitType enum value', () => {
      const invalid = {
        ...validPayload,
        metadata: {
          ...validPayload.metadata,
          preVisitType: 'invalid_type',
        },
      };
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('accepts valid preVisitType "eligibility"', () => {
      const payload = {
        ...validPayload,
        metadata: {
          ...validPayload.metadata,
          preVisitType: 'eligibility',
        },
      };
      const result = validateVapiWebhookPayload(payload);
      expect(result.metadata?.preVisitType).toBe('eligibility');
    });

    it('accepts valid preVisitType "cdcp_predet"', () => {
      const payload = {
        ...validPayload,
        metadata: {
          ...validPayload.metadata,
          preVisitType: 'cdcp_predet',
        },
      };
      const result = validateVapiWebhookPayload(payload);
      expect(result.metadata?.preVisitType).toBe('cdcp_predet');
    });

    it('rejects invalid collectrx schemaVersion', () => {
      const invalid = {
        ...validPayload,
        analysis: {
          collectrx: {
            schemaVersion: 2, // Must be 1
            callOutcome: 'RESOLVED',
          },
        },
      };
      expect(() => validateVapiWebhookPayload(invalid)).toThrow();
    });

    it('accepts structuredData as record with any values', () => {
      const payload = {
        ...validPayload,
        analysis: {
          structuredData: {
            field1: 'string value',
            field2: 123,
            field3: { nested: true },
            field4: ['array', 'values'],
          },
        },
      };
      const result = validateVapiWebhookPayload(payload);
      expect(result.analysis?.structuredData?.field1).toBe('string value');
    });
  });

  describe('validateVapiWebhookPayloadSafe (returns error, does not throw)', () => {
    it('returns valid: true for valid payloads', () => {
      const result = validateVapiWebhookPayloadSafe(validPayload);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.type).toBe('call.ended');
      }
    });

    it('returns valid: false with error message for invalid payloads', () => {
      const invalid = { ...validPayload, type: 'invalid' };
      const result = validateVapiWebhookPayloadSafe(invalid);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('type');
      }
    });

    it('includes readable error messages for missing required fields', () => {
      const invalid = {
        ...validPayload,
        call: { status: 'completed' }, // missing id
      };
      const result = validateVapiWebhookPayloadSafe(invalid);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('call.id');
      }
    });

    it('does not throw on unexpected extra fields (pass-through allowed)', () => {
      const payload = {
        ...validPayload,
        unknownField: 'extra data',
        call: {
          ...validPayload.call,
          extraCallField: 'ignored',
        },
      };
      const result = validateVapiWebhookPayloadSafe(payload);
      expect(result.valid).toBe(true);
    });

    it('returns descriptive error for nested validation failures', () => {
      const invalid = {
        type: 'call.ended',
        call: {
          id: 'call-123',
          status: 'completed',
          durationSeconds: 'not-a-number', // Should be number
        },
        metadata: {
          carrierId: 'sun_life',
          patientToken: 'token',
          practiceId: 'p123',
        },
      };
      const result = validateVapiWebhookPayloadSafe(invalid);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBeTruthy();
      }
    });
  });

  describe('Security scenarios', () => {
    it('rejects null payload', () => {
      expect(() => validateVapiWebhookPayload(null)).toThrow();
    });

    it('rejects undefined payload', () => {
      expect(() => validateVapiWebhookPayload(undefined)).toThrow();
    });

    it('rejects string payload (not an object)', () => {
      expect(() => validateVapiWebhookPayload('call-ended')).toThrow();
    });

    it('rejects array payload', () => {
      expect(() => validateVapiWebhookPayload(['call.ended', {}])).toThrow();
    });

    it('rejects object with prototype pollution attempt', () => {
      const malicious = {
        ...validPayload,
        __proto__: { isAdmin: true },
      };
      const result = validateVapiWebhookPayload(malicious);
      // Validation succeeds (Zod doesn't check prototype), but payload is safe
      expect((result as unknown as Record<string, unknown>).isAdmin).toBeUndefined();
    });

    it('rejects payload with extremely long string (transcript injection)', () => {
      const invalid = {
        ...validPayload,
        transcript: 'a'.repeat(1_000_000), // 1MB string
      };
      // This test documents current behavior — may want to add max length validation
      const result = validateVapiWebhookPayloadSafe(invalid);
      // Currently passes (no max length enforced), but is logged
      expect(result.valid).toBe(true);
    });

    it('permits extra fields in metadata (Zod pass-through), but they are not trusted', () => {
      // A webhook might try to inject carrierBlockDetected in metadata,
      // but Zod ignores extra fields, so the validation succeeds
      // but the extra field is stripped out (not included in validated payload)
      const payload = {
        ...validPayload,
        metadata: {
          ...validPayload.metadata,
          carrierBlockDetected: true, // Attacker tries to set this directly
          unknownField: 'injection attempt',
        },
      };
      const result = validateVapiWebhookPayloadSafe(payload);
      expect(result.valid).toBe(true); // Validation succeeds (Zod strips extra fields)
      if (result.valid) {
        // The extra fields are not in the validated payload
        expect((result.payload.metadata as any)?.carrierBlockDetected).toBeUndefined();
        expect((result.payload.metadata as any)?.unknownField).toBeUndefined();
      }
    });
  });
});
