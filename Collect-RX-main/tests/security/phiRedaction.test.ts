import { describe, it, expect } from 'vitest';
import {
  redactPII,
  redactObject,
  containsPII,
  detectPIITypes,
} from '../../src/server/logging/phiRedactor.js';

describe('PII Redaction', () => {
  describe('redactPII', () => {
    it('redacts SSNs', () => {
      const input = 'Patient SSN is 123-45-6789';
      const result = redactPII(input);
      expect(result).toContain('XXX-XX-XXXX');
      expect(result).not.toContain('123-45-6789');
    });

    it('redacts Canadian PHN', () => {
      const input = 'Health card: 1234 5678 9012';
      const result = redactPII(input);
      expect(result).toContain('XXXX XXXX XXXX');
    });

    it('redacts SIN', () => {
      const input = 'SIN 123-456-789';
      const result = redactPII(input);
      expect(result).toContain('XXX-XXX-XXX');
    });

    it('redacts phone numbers', () => {
      const input = 'Call 416-555-0100 or +1 (416) 555-0100';
      const result = redactPII(input);
      expect(result).toContain('XXX-XXX-XXXX');
      expect(result).not.toContain('416-555-0100');
    });

    it('redacts emails', () => {
      const input = 'Email: john.doe@example.com';
      const result = redactPII(input);
      expect(result).toContain('XXX@example.com');
      expect(result).not.toContain('john.doe@example.com');
    });

    it('redacts dates in ISO format', () => {
      const input = 'DOB: 1990-05-15';
      const result = redactPII(input);
      expect(result).toContain('XXXX-XX-XX');
      expect(result).not.toContain('1990-05-15');
    });

    it('redacts credit cards', () => {
      const input = 'Card: 1234-5678-9012-3456';
      const result = redactPII(input);
      expect(result).toContain('XXXX-XXXX-XXXX-XXXX');
    });

    it('handles non-string input gracefully', () => {
      expect(redactPII(null)).toBe('null');
      expect(redactPII(undefined)).toBe('undefined');
      expect(redactPII(123)).toBe('123');
    });
  });

  describe('redactObject', () => {
    it('redacts PII in object fields', () => {
      const input = {
        name: 'John Doe',
        email: 'john@example.com',
        ssn: '123-45-6789',
        id: 'user_123',
      };

      const result = redactObject(input) as Record<string, unknown>;
      expect(result.ssn).toBe('XXX-XX-XXXX');
      expect(result.email).toContain('XXX@example.com');
      expect(result.id).toBe('user_123'); // Safe fields not redacted
    });

    it('redacts PII in nested objects', () => {
      const input = {
        patient: {
          name: 'Jane Smith',
          dob: '1985-03-20',
          contact: {
            email: 'jane@example.com',
          },
        },
      };

      const result = redactObject(input) as any;
      expect(result.patient.dob).toContain('XXXX-XX-XX');
      expect(result.patient.contact.email).toContain('XXX@example.com');
    });

    it('redacts PII in arrays', () => {
      const input = {
        emails: ['john@example.com', 'jane@example.com'],
        phones: ['416-555-0100', '416-555-0101'],
      };

      const result = redactObject(input) as any;
      expect(result.emails[0]).toContain('XXX@example.com');
      expect(result.phones[0]).toContain('XXX-XXX-XXXX');
    });

    it('respects maxDepth parameter', () => {
      const deepInput = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: 'deep value',
                },
              },
            },
          },
        },
      };

      const result = redactObject(deepInput, {}, false, 3);
      const stringified = JSON.stringify(result);
      expect(stringified).toContain('[depth exceeded]');
    });

    it('handles known PHI fields', () => {
      const input = {
        patientName: 'John Doe',
        patient_name: 'Jane Smith',
        subscriberName: 'Bob Johnson',
        id: 'claim_123',
      };

      const result = redactObject(input) as Record<string, unknown>;
      expect(result.patientName).toBe('[REDACTED:PHI]');
      expect(result.patient_name).toBe('[REDACTED:PHI]');
      expect(result.subscriberName).toBe('[REDACTED:PHI]');
      expect(result.id).toBe('claim_123'); // Safe field
    });
  });

  describe('containsPII', () => {
    it('detects SSN', () => {
      expect(containsPII('SSN: 123-45-6789')).toBe(true);
    });

    it('detects emails', () => {
      expect(containsPII('Contact: john@example.com')).toBe(true);
    });

    it('detects phone numbers', () => {
      expect(containsPII('Call 416-555-0100')).toBe(true);
    });

    it('returns false for clean text', () => {
      expect(containsPII('This is a clean claim note')).toBe(false);
    });

    it('detects PII in objects', () => {
      expect(
        containsPII({
          claimId: 'claim_123',
          notes: 'Patient SSN is 123-45-6789',
        })
      ).toBe(true);
    });
  });

  describe('detectPIITypes', () => {
    it('detects multiple PII types', () => {
      const types = detectPIITypes({
        ssn: '123-45-6789',
        email: 'john@example.com',
        phone: '416-555-0100',
      });

      expect(types).toContain('SSN');
      expect(types).toContain('Email');
      expect(types).toContain('Phone');
    });

    it('returns empty array for clean data', () => {
      const types = detectPIITypes({
        claimId: 'claim_123',
        status: 'pending',
      });

      expect(types).toHaveLength(0);
    });
  });
});
