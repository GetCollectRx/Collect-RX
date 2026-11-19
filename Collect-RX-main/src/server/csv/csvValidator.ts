/**
 * Size and row limits shared by the CSV import parsers (parseSimple.ts and csvParser.ts).
 * Row-level validation lives with each parser, not here.
 */
export const CSV_LIMITS = {
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
  MAX_ROWS: 100_000,
  MAX_ERROR_RATE: 0.1, // 10% error rate threshold
  MAX_ERRORS_TO_STORE: 50, // Store first 50 errors in logs
};
