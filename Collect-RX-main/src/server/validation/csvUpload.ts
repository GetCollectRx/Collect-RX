/**
 * Validation helpers for CSV file uploads (multipart/form-data via multer).
 */

interface FileInfo {
  originalname?: string;
  mimetype?: string;
  size?: number;
}

interface CsvUploadOptions {
  maxBytes?: number;
}

export type CsvUploadResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function validateCsvUploadFile(
  file: FileInfo | undefined,
  opts: CsvUploadOptions = {},
): CsvUploadResult {
  if (!file) return { ok: false, status: 400, error: 'No file uploaded' };

  const { maxBytes = 10 * 1024 * 1024 } = opts;

  const allowed = ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/csv'];
  const name = file.originalname ?? '';
  const isCSV = name.toLowerCase().endsWith('.csv') || allowed.includes(file.mimetype ?? '');
  if (!isCSV) {
    return { ok: false, status: 400, error: 'File must be a CSV (.csv)' };
  }

  if (file.size !== undefined && file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return { ok: false, status: 413, error: `File exceeds maximum size of ${mb} MB` };
  }

  return { ok: true };
}
