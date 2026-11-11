import type { IdentifierType } from "./types.js";

/** A matched region of the (normalised) input text. */
export interface Span {
  start: number;
  end: number;
  type: IdentifierType;
  /** Canonical identity of the value, so equal values share one token. */
  key: string;
}

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export interface ValidatedContext {
  firstName: string | undefined;
  lastName: string | undefined;
  dob: Ymd | undefined;
  memberId: string | undefined;
  claimNumber: string | undefined;
}

/** Lower number wins when overlapping matches are merged into one token. */
export const TYPE_RANK: Readonly<Record<IdentifierType, number>> = {
  PATIENT_NAME: 0,
  DOB: 1,
  MEMBER_ID: 2,
  CLAIM_NUMBER: 3,
  EMAIL: 4,
  HEALTH_NUMBER: 5,
  PHONE: 6,
  DATE: 7,
  DIGIT_SEQUENCE: 8,
};

/** Characters that count as part of a word for boundary checks. */
export const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}])";
export const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}])";

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
