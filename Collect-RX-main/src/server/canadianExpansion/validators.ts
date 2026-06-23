/**
 * Lightweight validators for Phase 2 Canadian routes.
 * Throws ValidationError with a stable .field for caller-friendly 400s.
 */

export class ValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
    this.name = 'ValidationError';
  }
}

const TOKEN_RE = /^[A-Za-z0-9._-]+$/;
const CLAIM_REF_RE = /^[A-Za-z0-9._/:-]+$/;
const CDT_RE = /^D?\d{3,5}$/;
const CARRIER_RE = /^[a-z0-9_]+$/;
const STATUS_VALUES = new Set([
  'open',
  'pending_evidence',
  'submitted',
  'won',
  'lost',
  'expired',
  'excluded',
]);

export function requireString(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; pattern?: RegExp } = {}
): string {
  if (typeof value !== 'string') {
    throw new ValidationError(field, `${field} must be a string`);
  }
  const trimmed = value.trim();
  const min = opts.min ?? 1;
  const max = opts.max ?? 200;
  if (trimmed.length < min) {
    throw new ValidationError(field, `${field} must be at least ${min} characters`);
  }
  if (trimmed.length > max) {
    throw new ValidationError(field, `${field} must be at most ${max} characters`);
  }
  if (opts.pattern && !opts.pattern.test(trimmed)) {
    throw new ValidationError(field, `${field} contains invalid characters`);
  }
  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; pattern?: RegExp } = {}
): string | undefined {
  if (value == null || value === '') return undefined;
  return requireString(value, field, opts);
}

export function parseIsoDate(value: unknown, field: string, fallback?: Date): Date {
  if (value == null || value === '') {
    if (fallback) return fallback;
    throw new ValidationError(field, `${field} is required`);
  }
  if (typeof value !== 'string') {
    throw new ValidationError(field, `${field} must be an ISO date string`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(field, `${field} must be a valid date`);
  }
  // Reject dates more than 5 years in the future or before 2010
  const now = Date.now();
  if (d.getTime() > now + 5 * 365 * 86400_000) {
    throw new ValidationError(field, `${field} is unreasonably far in the future`);
  }
  if (d.getTime() < new Date('2010-01-01').getTime()) {
    throw new ValidationError(field, `${field} is unreasonably far in the past`);
  }
  return d;
}

export function parseFiniteNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {}
): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) {
    throw new ValidationError(field, `${field} must be a finite number`);
  }
  if (opts.min != null && n < opts.min) {
    throw new ValidationError(field, `${field} must be ≥ ${opts.min}`);
  }
  if (opts.max != null && n > opts.max) {
    throw new ValidationError(field, `${field} must be ≤ ${opts.max}`);
  }
  return n;
}

export interface ReconsiderationCreateInput {
  patientToken: string;
  claimRef: string;
  carrierCode: string;
  procedureCode: string | undefined;
  denialDate: Date;
  clinicalEvidenceSummary: string | undefined;
  originalAdjudicatorHint: string | undefined;
}

export function validateReconsiderationCreate(body: unknown): ReconsiderationCreateInput {
  const b = (body || {}) as Record<string, unknown>;
  return {
    patientToken: requireString(b.patient_token, 'patient_token', { max: 80, pattern: TOKEN_RE }),
    claimRef: requireString(b.claim_ref, 'claim_ref', { max: 120, pattern: CLAIM_REF_RE }),
    carrierCode: requireString(b.carrier_code ?? 'cdcp_sunlife', 'carrier_code', {
      max: 40,
      pattern: CARRIER_RE,
    }),
    procedureCode: optionalString(b.procedure_code, 'procedure_code', {
      max: 12,
      pattern: CDT_RE,
    }),
    denialDate: parseIsoDate(b.denial_date, 'denial_date', new Date()),
    clinicalEvidenceSummary: optionalString(b.clinical_evidence_summary, 'clinical_evidence_summary', {
      max: 2000,
    }),
    originalAdjudicatorHint: optionalString(b.original_adjudicator_hint, 'original_adjudicator_hint', {
      max: 120,
    }),
  };
}

export function validateReconsiderationStatus(body: unknown): string {
  const b = (body || {}) as Record<string, unknown>;
  const status = requireString(b.status, 'status', { max: 32 });
  if (!STATUS_VALUES.has(status)) {
    throw new ValidationError('status', `status must be one of: ${[...STATUS_VALUES].join(', ')}`);
  }
  return status;
}

export interface GapEstimateInput {
  province: 'ON' | 'BC' | 'AB';
  procedures: Array<{ cdt_code: string; office_fee_cad: number }>;
}

export function validateGapEstimate(body: unknown): GapEstimateInput {
  const b = (body || {}) as Record<string, unknown>;
  const province = requireString(b.province ?? 'ON', 'province', { max: 2 }).toUpperCase();
  if (province !== 'ON' && province !== 'BC' && province !== 'AB') {
    throw new ValidationError('province', 'province must be ON, BC, or AB');
  }
  if (!Array.isArray(b.procedures)) {
    throw new ValidationError('procedures', 'procedures must be an array');
  }
  if (b.procedures.length === 0) {
    throw new ValidationError('procedures', 'procedures cannot be empty');
  }
  if (b.procedures.length > 50) {
    throw new ValidationError('procedures', 'procedures cannot exceed 50 entries');
  }
  const procedures = b.procedures.map((p, i) => {
    const item = (p || {}) as Record<string, unknown>;
    return {
      cdt_code: requireString(item.cdt_code, `procedures[${i}].cdt_code`, {
        max: 12,
        pattern: CDT_RE,
      }),
      office_fee_cad: parseFiniteNumber(item.office_fee_cad, `procedures[${i}].office_fee_cad`, {
        min: 0,
        max: 100_000,
      }),
    };
  });
  return { province: province as 'ON' | 'BC' | 'AB', procedures };
}

export interface WritebackInput {
  source: 'resolution_closer' | 'escalation_closer';
  claimRef: string;
  abeldentPatientId: string | undefined;
  payload: Record<string, unknown>;
}

export function validateWriteback(body: unknown): WritebackInput {
  const b = (body || {}) as Record<string, unknown>;
  const source = requireString(b.source, 'source', { max: 32 });
  if (source !== 'resolution_closer' && source !== 'escalation_closer') {
    throw new ValidationError('source', 'source must be resolution_closer or escalation_closer');
  }
  const claimRef = requireString(b.claim_ref, 'claim_ref', { max: 120, pattern: CLAIM_REF_RE });
  const abeldentPatientId = optionalString(b.abeldent_patient_id, 'abeldent_patient_id', {
    max: 80,
    pattern: TOKEN_RE,
  });
  const rawPayload = b.payload;
  if (rawPayload == null) {
    return { source, claimRef, abeldentPatientId, payload: {} };
  }
  if (typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    throw new ValidationError('payload', 'payload must be a JSON object');
  }
  const json = JSON.stringify(rawPayload);
  if (json.length > 8_000) {
    throw new ValidationError('payload', 'payload exceeds 8KB');
  }
  return {
    source,
    claimRef,
    abeldentPatientId,
    payload: rawPayload as Record<string, unknown>,
  };
}
