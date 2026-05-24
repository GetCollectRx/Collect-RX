/**
 * CSV upload guards — MIME/extension allowlist and size caps (multer limits are necessary but not sufficient).
 */

export type CsvUploadCheck = { ok: true } | { ok: false; status: number; error: string };

const DEFAULT_ALLOWED_EXT = new Set(['.csv', '.txt']);
const DEFAULT_ALLOWED_MIME = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
]);

export type CsvUploadOptions = {
  maxBytes?: number;
  allowedExtensions?: Set<string>;
  allowedMimeTypes?: Set<string>;
};

export type UploadedCsvFile = {
  buffer?: Buffer;
  size: number;
  originalname?: string;
  mimetype?: string;
};

export function validateCsvUploadFile(
  file: UploadedCsvFile | undefined,
  opts: CsvUploadOptions = {},
): CsvUploadCheck {
  if (!file?.buffer?.length) {
    return { ok: false, status: 400, error: 'CSV file required (field name: file)' };
  }
  const maxBytes = opts.maxBytes ?? 12 * 1024 * 1024;
  if (file.size > maxBytes || file.buffer.length > maxBytes) {
    return { ok: false, status: 400, error: `File exceeds maximum size (${maxBytes} bytes)` };
  }
  const extSet = opts.allowedExtensions ?? DEFAULT_ALLOWED_EXT;
  const mimeSet = opts.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME;
  const name = (file.originalname || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (ext && !extSet.has(ext)) {
    return { ok: false, status: 400, error: 'Only .csv or .txt uploads are allowed' };
  }
  const mime = (file.mimetype || '').toLowerCase().split(';')[0]!.trim();
  if (mime && !mimeSet.has(mime)) {
    return { ok: false, status: 400, error: 'Invalid file type — upload a CSV file' };
  }
  return { ok: true };
}
