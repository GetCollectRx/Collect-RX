import { describe, it, expect } from 'vitest';
import {
  validateCsvRow,
  escapeCsvInjection,
  validatePhoneFormat,
  validateEmailFormat,
  validateDateFormat,
  validateAmountFormat,
  CSV_LIMITS,
} from './csvValidator';
import { parseSimpleCsv, computeCsvHash } from './parseSimple';

describe('CSV Security', () => {
  describe('CSV Injection Prevention', () => {
    it('should escape formulas starting with =', () => {
      const row = {
        patient_first_name: 'John',
        patient_last_name: 'Doe',
        patient_phone: '14155552671',
        patient_email: '',
        patient_owes: '100.00',
        claim_number: '123',
      };
      const withFormula = { ...row, patient_first_name: '=1+1' };
      const escaped = escapeCsvInjection(withFormula);
      expect(escaped.patient_first_name).toBe("'=1+1");
    });

    it('should escape formulas starting with +, -, @, %', () => {
      const testCases = [
        { value: '+1', expected: "'+1" },
        { value: '-2', expected: "'-2" },
        { value: '@SUM(A1:A10)', expected: "'@SUM(A1:A10)" },
        { value: '%FORMULA', expected: "'%FORMULA" },
      ];

      testCases.forEach(({ value, expected }) => {
        const escaped = escapeCsvInjection({ field: value });
        expect(escaped.field).toBe(expected);
      });
    });

    it('should not escape safe values', () => {
      const testCases = [
        'John Doe',
        '123-456-7890',
        'test@example.com',
        'normal text',
        'value with spaces',
      ];

      testCases.forEach((value) => {
        const escaped = escapeCsvInjection({ field: value });
        expect(escaped.field).toBe(value);
      });
    });
  });

  describe('Phone Format Validation', () => {
    it('should accept valid E.164 format', () => {
      expect(validatePhoneFormat('+14155552671')).toBe(true);
      expect(validatePhoneFormat('14155552671')).toBe(true);
    });

    it('should accept empty phones (optional field)', () => {
      expect(validatePhoneFormat('')).toBe(true);
    });

    it('should reject invalid phone formats', () => {
      expect(validatePhoneFormat('555')).toBe(false);
      expect(validatePhoneFormat('123')).toBe(false);
      expect(validatePhoneFormat('abc')).toBe(false);
    });
  });

  describe('Email Format Validation', () => {
    it('should accept valid email formats', () => {
      expect(validateEmailFormat('test@example.com')).toBe(true);
      expect(validateEmailFormat('user.name+tag@example.co.uk')).toBe(true);
    });

    it('should accept empty emails (optional field)', () => {
      expect(validateEmailFormat('')).toBe(true);
    });

    it('should reject invalid email formats', () => {
      expect(validateEmailFormat('notanemail')).toBe(false);
      expect(validateEmailFormat('missing@domain')).toBe(false);
      expect(validateEmailFormat('@nodomain.com')).toBe(false);
    });
  });

  describe('Date Format Validation', () => {
    it('should accept valid YYYY-MM-DD dates', () => {
      expect(validateDateFormat('2024-01-15')).toBe(true);
      expect(validateDateFormat('2025-12-31')).toBe(true);
    });

    it('should accept empty dates (optional field)', () => {
      expect(validateDateFormat('')).toBe(true);
    });

    it('should reject invalid date formats', () => {
      expect(validateDateFormat('01-15-2024')).toBe(false);
      expect(validateDateFormat('2024/01/15')).toBe(false);
      expect(validateDateFormat('2024-13-01')).toBe(false); // Invalid month
    });
  });

  describe('Amount Format Validation', () => {
    it('should accept valid currency amounts', () => {
      expect(validateAmountFormat('100.00')).toBe(true);
      expect(validateAmountFormat('1000')).toBe(true);
      expect(validateAmountFormat('99.99')).toBe(true);
    });

    it('should accept empty amounts (optional field)', () => {
      expect(validateAmountFormat('')).toBe(true);
      expect(validateAmountFormat('0')).toBe(true);
    });

    it('should reject invalid amount formats', () => {
      expect(validateAmountFormat('abc')).toBe(false);
      expect(validateAmountFormat('100.999')).toBe(false); // More than 2 decimals
      expect(validateAmountFormat('-50')).toBe(false); // Negative
    });
  });

  describe('Row-Level Validation', () => {
    it('should validate a complete valid row', () => {
      const row = {
        patient_first_name: 'John',
        patient_last_name: 'Doe',
        patient_phone: '14155552671',
        patient_email: 'john@example.com',
        patient_owes: '100.00',
        claim_number: '12345',
      };
      expect(() => validateCsvRow(row, 1)).not.toThrow();
    });

    it('should reject rows missing required fields', () => {
      const row = {
        patient_first_name: 'John',
        // Missing patient_last_name
        patient_owes: '100.00',
        claim_number: '12345',
      };
      expect(() => validateCsvRow(row as Record<string, unknown>, 1)).toThrow();
    });

    it('should reject rows with invalid email', () => {
      const row = {
        patient_first_name: 'John',
        patient_last_name: 'Doe',
        patient_email: 'invalid-email',
        patient_owes: '100.00',
        claim_number: '12345',
      };
      expect(() => validateCsvRow(row as Record<string, unknown>, 1)).toThrow();
    });
  });

  describe('parseSimpleCsv with Security', () => {
    it('should parse valid CSV without errors', () => {
      const csv = `patient_first_name,patient_last_name,patient_email,patient_owes,claim_number
John,Doe,john@example.com,100.00,12345
Jane,Smith,jane@example.com,250.50,12346`;
      const rows = parseSimpleCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.patient_first_name).toBe('John');
    });

    it('should escape CSV injection formulas', () => {
      const csv = `patient_first_name,patient_last_name,patient_owes,claim_number
=1+1,Doe,100.00,12345`;
      const rows = parseSimpleCsv(csv);
      expect(rows[0]?.patient_first_name).toBe("'=1+1");
    });

    it('should reject CSV exceeding row limit', () => {
      const csvRows = ['patient_first_name,patient_last_name,patient_owes,claim_number'];
      for (let i = 0; i < CSV_LIMITS.MAX_ROWS + 1; i++) {
        csvRows.push(`John${i},Doe${i},100.00,${12345 + i}`);
      }
      const csv = csvRows.join('\n');

      expect(() => parseSimpleCsv(csv)).toThrow();
    });

    it('should reject CSV exceeding size limit', () => {
      const largeText = 'a'.repeat(CSV_LIMITS.MAX_FILE_SIZE_BYTES + 1);
      expect(() => parseSimpleCsv(largeText)).toThrow();
    });

    it('should return empty array for CSV with only headers', () => {
      const csv = 'patient_first_name,patient_last_name,patient_owes,claim_number';
      const rows = parseSimpleCsv(csv);
      expect(rows).toHaveLength(0);
    });

    it('should handle quoted fields correctly', () => {
      const csv = `patient_first_name,patient_last_name,patient_owes,claim_number
"John ""The Great"" Smith",Doe,100.00,12345`;
      const rows = parseSimpleCsv(csv);
      expect(rows[0]?.patient_first_name).toContain('John');
    });
  });

  describe('Hash Computation', () => {
    it('should compute consistent SHA-256 hash', () => {
      const csv = 'test,data\nvalue1,value2';
      const hash1 = computeCsvHash(csv);
      const hash2 = computeCsvHash(csv);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different content', () => {
      const csv1 = 'test,data\nvalue1,value2';
      const csv2 = 'test,data\nvalue1,value3';
      const hash1 = computeCsvHash(csv1);
      const hash2 = computeCsvHash(csv2);
      expect(hash1).not.toBe(hash2);
    });

    it('hash should be valid hex string', () => {
      const csv = 'test,data\nvalue1,value2';
      const hash = computeCsvHash(csv);
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 is 64 hex chars
    });
  });

  describe('CSV Limits Constants', () => {
    it('should have reasonable limits defined', () => {
      expect(CSV_LIMITS.MAX_FILE_SIZE_BYTES).toBe(100 * 1024 * 1024); // 100MB
      expect(CSV_LIMITS.MAX_ROWS).toBe(100_000);
      expect(CSV_LIMITS.MAX_ERROR_RATE).toBe(0.1);
      expect(CSV_LIMITS.MAX_ERRORS_TO_STORE).toBe(50);
    });
  });

  describe('Real-World CSV Scenarios', () => {
    it('should handle CSV with empty fields', () => {
      const csv = `patient_first_name,patient_last_name,patient_email,patient_owes,claim_number
John,Doe,,100.00,12345
Jane,Smith,jane@example.com,,12346`;
      const rows = parseSimpleCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.patient_email).toBe('');
    });

    it('should handle CSV with special characters in text fields', () => {
      const csv = `patient_first_name,patient_last_name,patient_email,patient_owes,claim_number
François,O'Brien,francois@example.com,100.00,12345`;
      const rows = parseSimpleCsv(csv);
      expect(rows[0]?.patient_first_name).toBe('François');
      expect(rows[0]?.patient_last_name).toBe("O'Brien");
    });

    it('should handle CRLF line endings', () => {
      const csv =
        'patient_first_name,patient_last_name,patient_owes,claim_number\r\nJohn,Doe,100.00,12345\r\nJane,Smith,250.00,12346';
      const rows = parseSimpleCsv(csv);
      expect(rows).toHaveLength(2);
    });
  });
});
