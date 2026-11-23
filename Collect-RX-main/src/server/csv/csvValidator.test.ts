import { describe, it, expect } from 'vitest';
import { CSV_LIMITS } from './csvValidator';
import { parseSimpleCsv, computeCsvHash } from './parseSimple';

describe('CSV Security', () => {
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
