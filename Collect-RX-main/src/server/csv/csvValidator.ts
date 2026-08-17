import { z } from 'zod';

// CSV schema for patient claims data
export const ClaimRowSchema = z.object({
  patient_first_name: z.string().min(1).max(100),
  patient_last_name: z.string().min(1).max(100),
  patient_phone: z.string().regex(/^\+?1?\d{10}$/, 'Invalid E.164 phone format').optional().or(z.literal('')),
  patient_email: z.string().email('Invalid email format').optional().or(z.literal('')),
  patient_owes: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount format').or(z.literal('')),
  abeldent_patient_id: z.string().optional().or(z.literal('')),
  treatment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format YYYY-MM-DD').optional().or(z.literal('')),
  procedure_code: z.string().optional().or(z.literal('')),
  procedure_description: z.string().optional().or(z.literal('')),
  adjudication_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format YYYY-MM-DD').optional().or(z.literal('')),
  days_since_adjudication: z.string().regex(/^\d+$/, 'Must be a number').optional().or(z.literal('')),
  claim_number: z.string().min(1).max(50),
  insurance_carrier: z.string().optional().or(z.literal('')),
  group_policy_number: z.string().optional().or(z.literal('')),
  subscriber_id: z.string().optional().or(z.literal('')),
});

export type ClaimRow = z.infer<typeof ClaimRowSchema>;

/**
 * Validates a single CSV row and prevents CSV injection attacks.
 * Throws with detailed error messages on validation failure.
 */
export function validateCsvRow(row: Record<string, unknown>, rowNumber: number): ClaimRow {
  try {
    // Escape formulas first to prevent injection
    const cleanRow = escapeCsvInjection(row);
    // Trim all string values
    const trimmedRow = trimObjectStrings(cleanRow);
    return ClaimRowSchema.parse(trimmedRow);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((issue: z.ZodIssue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(`Row ${rowNumber} validation failed: ${issues}`);
    }
    throw error;
  }
}

/**
 * Escapes CSV injection formulas (=, +, -, @, %)
 * by prepending a single quote to prevent execution
 */
export function escapeCsvInjection(obj: Record<string, unknown>): Record<string, unknown> {
  const escaped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Escape formulas that start with dangerous characters
      if (/^[=+\-@%]/.test(value.trim())) {
        escaped[key] = "'" + value; // Prepend single quote to escape
      } else {
        escaped[key] = value;
      }
    } else {
      escaped[key] = value;
    }
  }
  return escaped;
}

/**
 * Trims whitespace from all string values in an object
 */
function trimObjectStrings(obj: Record<string, unknown>): Record<string, unknown> {
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      trimmed[key] = value.trim();
    } else {
      trimmed[key] = value;
    }
  }
  return trimmed;
}

/**
 * Validates phone number format (E.164 or North American variants)
 */
export function validatePhoneFormat(phone: string): boolean {
  if (!phone) return true; // Optional field
  // Allow +1234567890 (11 digits with country code) or 2134567890 (10 digits)
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length === 10 || cleaned.length === 11;
}

/**
 * Validates email format using a simple regex (RFC 5322 simplified)
 */
export function validateEmailFormat(email: string): boolean {
  if (!email) return true; // Optional field
  // Simple RFC 5322 regex check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates date format (YYYY-MM-DD) and that it's a valid date
 */
export function validateDateFormat(dateStr: string): boolean {
  if (!dateStr) return true; // Optional field
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Validates amount format (valid currency amount)
 */
export function validateAmountFormat(amount: string): boolean {
  if (!amount || amount === '0') return true; // Optional field
  return /^\d+(\.\d{1,2})?$/.test(amount);
}

/**
 * CSV import audit log entry
 */
export interface CsvImportLog {
  fileName: string;
  fileHash: string;
  rowCount: number;
  errorCount: number;
  status: 'success' | 'quarantined' | 'partial';
  errorDetails?: string;
  importedBy: string;
  importedAt: Date;
  ipAddress?: string;
}

/**
 * Result of parsing and validating a CSV file
 */
export interface CsvParseResult {
  rows: ClaimRow[];
  errors: Array<{ rowNumber: number; error: string }>;
  totalRows: number;
  fileHash: string;
  fileName: string;
  importedAt: Date;
  importedBy: string;
}

/**
 * Constants for CSV validation limits
 */
export const CSV_LIMITS = {
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
  MAX_ROWS: 100_000,
  MAX_ERROR_RATE: 0.1, // 10% error rate threshold
  MAX_ERRORS_TO_STORE: 50, // Store first 50 errors in logs
};
