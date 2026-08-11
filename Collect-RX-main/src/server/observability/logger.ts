/**
 * Canonical structured logger — one JSON line per entry, correlation-ID
 * aware, PHI-redacting. Consolidates what used to be two loggers:
 *
 *   - This file (function-style `logLine(level, msg, meta)`, email/phone
 *     redaction only) — used by emailService.ts, phiCryptoAudit.ts,
 *     guardrailAuditWorker.ts.
 *   - src/logger.cjs (method-style `logger.warn(msg, meta)`, winston +
 *     file transports, field-name + date/pattern PHI scrubbing) — used by
 *     queueEngine.ts, routes/insurance.ts.
 *
 * Both call shapes are supported here (`logLine` for the former,
 * `logger.warn/error/info/debug/audit` for the latter — see Contract C1 in
 * the production-safety backlog) so migrating callers is an import-path
 * change, not a call-site rewrite. logger.cjs's winston/file-transport
 * machinery is not carried forward: on Fly.io the container filesystem is
 * ephemeral, so file-based rotation logs nothing durable that stdout
 * (captured by the platform) doesn't already provide.
 *
 * PHI redaction is widened, not narrowed, by this consolidation — see the
 * comment above PHI_FIELD_NAMES for exactly what changed and why one
 * pattern from the legacy logger was deliberately NOT ported.
 */
import { getCorrelationId } from './correlationContext.js';

const EMAIL = /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
const PHONE = /(?:\+1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/**
 * Field names whose value is always fully redacted, regardless of content —
 * ported from the legacy logger.cjs list (patient_name, patient_dob,
 * policy_number, subscriber_name, claim_number, treatment_codes,
 * treatment_date, claim_submitted_date, group_number) with camelCase
 * variants added and cross-checked against vapi/client.ts's VapiCallParams,
 * the actual source of every PHI-adjacent field name this system passes
 * around. Consolidating onto one logger must not narrow protection that
 * existed in either predecessor, so this is a superset of both.
 *
 * Deliberately NOT ported: logger.cjs's "First Last"-shaped-string pattern
 * match, which replaced the ENTIRE value of any field whose string content
 * merely looked like two capitalized words. That already existed in
 * logger.cjs, but only 2 files used it. Applying it universally here would
 * hit constantly on values this system logs everywhere and that are not
 * PHI — carrier IDs like "Sun Life"/"Green Shield"/"Canada Life", practice
 * names, city names — silently destroying useful log content far more
 * often than it would ever catch a real leaked name. Field-name redaction
 * below already covers patient_name/subscriber_name reliably; a pattern
 * match that can't tell "Sun Life" from a patient's name is a worse trade
 * than not having it.
 */
const PHI_FIELD_NAMES = new Set([
  'patient_name', 'patientName',
  'patient_dob', 'patientDob', 'dateOfBirth',
  'policy_number', 'policyNumber',
  'subscriber_name', 'subscriberName',
  'subscriber_dob', 'subscriberDob',
  'claim_number', 'claimNumber',
  'treatment_codes', 'treatmentCodes',
  'treatment_date', 'treatmentDate',
  'claim_submitted_date', 'claimSubmittedDate',
  'group_number', 'groupNumber',
]);

const PHI_REDACTED_VALUE = '[redacted:phi]';

/** Surgical substring redaction — replaces only the matched span, not the whole value. */
export function redactString(s: string): string {
  if (!s) {
    return s;
  }
  return s
    .replace(EMAIL, '[redacted:email]')
    .replace(PHONE, '[redacted:phone]')
    .replace(ISO_DATE, '[redacted:date]');
}

function safeMetaValue(key: string, value: unknown): unknown {
  if (PHI_FIELD_NAMES.has(key)) {
    return PHI_REDACTED_VALUE;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? redactString(v) : v));
  }
  // Error.message/.stack are non-enumerable, so Object.entries (what safeMeta
  // does below) silently returns {} for any Error not passed through the
  // dedicated `error` key on logger.error() — e.g. logger.warn(msg, { cause:
  // someError }). Serialize explicitly so those don't lose PHI redaction.
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack };
  }
  if (value && typeof value === 'object') {
    return safeMeta(value as Record<string, unknown>);
  }
  return value;
}

export function safeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    o[k] = safeMetaValue(k, v);
  }
  return o;
}

export type Level = 'info' | 'warn' | 'error' | 'debug';

/** LogMeta per Contract C1 — correlationId is auto-filled from context if the caller didn't set one. */
export interface LogMeta {
  correlationId?: string;
  tenantId?: string;
  userId?: string;
  route?: string;
  method?: string;
  [key: string]: unknown;
}

export function logLine(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const time = new Date().toISOString();
  const correlationId = (meta as LogMeta | undefined)?.correlationId ?? getCorrelationId();
  const safe = safeMeta(meta);
  const out = {
    level,
    msg: redactString(msg),
    time,
    service: 'collectrx-api',
    ...(correlationId ? { correlationId } : {}),
    ...safe,
  } as Record<string, unknown>;
  const line = JSON.stringify(out);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else if (level === 'debug') {
    console.debug(line);
  } else {
    console.log(line);
  }
}

/**
 * Method-style API matching Contract C1 (StructuredLogger) — this is the
 * shape logger.cjs's callers already use (logger.warn(msg, meta),
 * logger.error(msg, meta), logger.audit(event, context)), so migrating a
 * call site from logger.cjs to here is an import-path change only.
 */
export const logger = {
  /**
   * `error` accepts `unknown` (not just `Error`) because every caller gets
   * it from a `catch` block, where TypeScript strict mode types the bound
   * variable `unknown` — requiring every call site to narrow it first
   * before logging would be exactly the friction that keeps error paths on
   * raw `console.error` instead of structured logging.
   */
  error(msg: string, meta?: LogMeta & { error?: unknown }): void {
    const { error, ...rest } = meta ?? {};
    if (error instanceof Error) {
      logLine('error', msg, { ...rest, error: error.message, stack: error.stack });
    } else if (error !== undefined) {
      logLine('error', msg, { ...rest, error: String(error) });
    } else {
      logLine('error', msg, rest);
    }
  },
  warn(msg: string, meta?: LogMeta): void {
    logLine('warn', msg, meta);
  },
  info(msg: string, meta?: LogMeta): void {
    logLine('info', msg, meta);
  },
  debug(msg: string, meta?: LogMeta): void {
    logLine('debug', msg, meta);
  },
  /** Structured audit event — matches logger.cjs's logger.audit(event, context) shape. */
  audit(event: string, context: Record<string, unknown> = {}): void {
    logLine('info', `AUDIT: ${event}`, { audit: true, event, ...context });
  },
};

export default logger;
