import type { CallContext } from "./types.js";
import type { ValidatedContext, Ymd } from "./internal.js";

export const MAX_TEXT_LENGTH = 100000;

export const ERR_INPUT = "phi-redact: invalid input";
export const ERR_TOO_LONG = "phi-redact: input exceeds maximum length";
export const ERR_CONTEXT = "phi-redact: invalid context";
export const ERR_INTERNAL = "phi-redact: internal failure";

const CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "patientFirstName",
  "patientLastName",
  "dateOfBirth",
  "memberId",
  "claimNumber",
]);

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'\u2019-]*$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _./-]*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MIN_NAME = 2;
const MAX_NAME = 100;
const MIN_ID_ALNUM = 4;
const MAX_ID = 64;
const MIN_DOB_YEAR = 1850;
const MAX_DOB_YEAR = 2100;

export function daysInMonth(y: number, m: number): number {
  if (m === 2) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? 29 : 28;
  }
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

export function assertText(text: unknown): string {
  if (typeof text !== "string") {
    throw new Error(ERR_INPUT);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(ERR_TOO_LONG);
  }
  return text;
}

function readOptional(source: Record<string, unknown>, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return undefined;
  }
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(ERR_CONTEXT);
  }
  return value.normalize("NFKC").trim();
}

function validName(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.length < MIN_NAME || value.length > MAX_NAME || !NAME_PATTERN.test(value)) {
    throw new Error(ERR_CONTEXT);
  }
  return value;
}

function validId(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.length > MAX_ID || !ID_PATTERN.test(value)) {
    throw new Error(ERR_CONTEXT);
  }
  if (value.replace(/[^A-Za-z0-9]/g, "").length < MIN_ID_ALNUM) {
    throw new Error(ERR_CONTEXT);
  }
  return value;
}

function validDob(value: string | undefined): Ymd | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = ISO_DATE.exec(value);
  if (match === null) {
    throw new Error(ERR_CONTEXT);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (
    y < MIN_DOB_YEAR ||
    y > MAX_DOB_YEAR ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > daysInMonth(y, m)
  ) {
    throw new Error(ERR_CONTEXT);
  }
  return { y, m, d };
}

export function validateContext(context: CallContext): ValidatedContext {
  try {
    return parseContext(context);
  } catch {
    // Context values are identifiers, so no underlying error text is ever surfaced.
    throw new Error(ERR_CONTEXT);
  }
}

function parseContext(context: CallContext): ValidatedContext {
  const raw: unknown = context;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(ERR_CONTEXT);
  }
  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!CONTEXT_KEYS.has(key)) {
      throw new Error(ERR_CONTEXT);
    }
  }
  return {
    firstName: validName(readOptional(source, "patientFirstName")),
    lastName: validName(readOptional(source, "patientLastName")),
    dob: validDob(readOptional(source, "dateOfBirth")),
    memberId: validId(readOptional(source, "memberId")),
    claimNumber: validId(readOptional(source, "claimNumber")),
  };
}
