/**
 * P6-01 — JSON-friendly logs; redact email/phone-like substrings in free text.
 * Set LOG_JSON=1 (or rely on production default in http middleware) to emit one JSON object per line to stdout.
 */

const EMAIL = /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
const PHONE = /(?:\+1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/g;

export function redactString(s: string): string {
  if (!s) {
    return s;
  }
  return s.replace(EMAIL, '[redacted:email]').replace(PHONE, '[redacted:phone]');
}

function safeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'string') {
      o[k] = redactString(v);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      o[k] = safeMeta(v as Record<string, unknown>) ?? v;
    } else {
      o[k] = v;
    }
  }
  return o;
}

type Level = 'info' | 'warn' | 'error' | 'debug';

export function logLine(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const time = new Date().toISOString();
  const safe = safeMeta(meta);
  const out = { level, msg, time, ...safe } as Record<string, unknown>;
  const line = JSON.stringify(out);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}
