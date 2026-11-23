import { SYNTHETIC_CARRIERS, SYNTHETIC_NAMES, SYNTHETIC_PROCEDURE_CODES } from "./names.js";
import { SeededRandom } from "./prng.js";

/**
 * Column set and order for the live import path: parseSimpleCsv, then
 * normalizePmsClaimRow with the generic import family. Each header is a
 * snake_case key that path reads, and the reason it is present is below.
 */
export const SYNTHETIC_HEADERS = [
  "claim_number", // required: a row without a claim id fails the whole file
  "patient_first_name", // tokenised into the PHI vault
  "patient_last_name", // tokenised into the PHI vault
  "patient_dob", // vault; the carrier asks for it
  "subscriber_id", // vault; the member id the carrier asks for
  "group_policy_number", // vault; the group number the carrier asks for
  "insurance_carrier", // required: a blank or unknown carrier fails the whole file
  "procedure_code", // first CDT code
  "treatment_codes", // an empty value raises a BLOCKING submission gate that keeps the claim out of the call queue
  "treatment_date", // date of service; empty raises a non-blocking gate
  "submitted_date", // submission date; empty raises a non-blocking gate
  "amount_billed",
  "amount_outstanding", // must be above zero or the row is skipped
  "expected_amount", // above zero, or a non-blocking gate disables underpayment detection
  "days_outstanding", // 30 to 90 enters the call queue; this value overrides any computed age
] as const;

export type SyntheticHeader = (typeof SYNTHETIC_HEADERS)[number];

export interface SyntheticClaim {
  claim_number: string;
  patient_first_name: string;
  patient_last_name: string;
  patient_dob: string;
  subscriber_id: string;
  group_policy_number: string;
  insurance_carrier: string;
  procedure_code: string;
  treatment_codes: string;
  treatment_date: string;
  submitted_date: string;
  amount_billed: string;
  amount_outstanding: string;
  expected_amount: string;
  days_outstanding: string;
}

export interface SyntheticContext {
  patientFirstName: string;
  patientLastName: string;
  dateOfBirth: string;
  memberId: string;
  claimNumber: string;
}

export interface SyntheticRecord {
  claim: SyntheticClaim;
  context: SyntheticContext;
}

export const MEMBER_ID_PREFIX = "SYN-";
export const CLAIM_NUMBER_PREFIX = "SYN-CLM-";
export const GROUP_NUMBER_PREFIX = "SYN-GRP-";

/**
 * Dates of birth are drawn from 1900-01-01 to 1929-12-31. The range is outside
 * any living person's, so a generated value cannot be mistaken for a real one.
 */
export const DOB_RANGE = { first: "1900-01-01", last: "1929-12-31" } as const;

/** Service dates count back from this fixed anchor so output never depends on the clock. */
export const ANCHOR_DATE = "2026-06-30";

export const MIN_DAYS_OUTSTANDING = 32;
export const MAX_DAYS_OUTSTANDING = 88;
export const MAX_COUNT = 10000;

const DAY_MS = 86400000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatCents(cents: number): string {
  return `${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, "0")}`;
}

function uniqueId(rng: SeededRandom, used: Set<string>, prefix: string, width: number): string {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const id = `${prefix}${rng.digits(width)}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  throw new Error("synthetic-data: could not generate a unique identifier");
}

function dateOfBirth(rng: SeededRandom): string {
  const first = Date.parse(DOB_RANGE.first);
  const last = Date.parse(DOB_RANGE.last);
  return isoDate(first + rng.int(0, Math.round((last - first) / DAY_MS)) * DAY_MS);
}

/** Pure and deterministic: the same seed and count always give the same records. */
export function generateRecords(count: number, seed: string): SyntheticRecord[] {
  const rng = new SeededRandom(seed);
  const memberIds = new Set<string>();
  const claimNumbers = new Set<string>();
  const anchor = Date.parse(ANCHOR_DATE);
  const records: SyntheticRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const name = rng.pick(SYNTHETIC_NAMES);
    const memberId = uniqueId(rng, memberIds, MEMBER_ID_PREFIX, 8);
    const claimNumber = uniqueId(rng, claimNumbers, CLAIM_NUMBER_PREFIX, 6);
    const dob = dateOfBirth(rng);
    const days = rng.int(MIN_DAYS_OUTSTANDING, MAX_DAYS_OUTSTANDING);
    const treatment = anchor - days * DAY_MS;
    const submitted = treatment + rng.int(1, 3) * DAY_MS;
    const billedCents = rng.int(8000, 150000);
    const outstandingCents = Math.max(100, Math.round(billedCents * (rng.int(40, 100) / 100)));
    const expectedCents = Math.max(100, Math.round(outstandingCents * 0.8));
    const firstCode = rng.pick(SYNTHETIC_PROCEDURE_CODES);
    const codes = rng.int(0, 1) === 0 ? [firstCode] : [firstCode, rng.pick(SYNTHETIC_PROCEDURE_CODES)];
    records.push({
      claim: {
        claim_number: claimNumber,
        patient_first_name: name.first,
        patient_last_name: name.last,
        patient_dob: dob,
        subscriber_id: memberId,
        group_policy_number: `${GROUP_NUMBER_PREFIX}${rng.digits(4)}`,
        insurance_carrier: rng.pick(SYNTHETIC_CARRIERS),
        procedure_code: firstCode,
        treatment_codes: [...new Set(codes)].join(","),
        treatment_date: isoDate(treatment),
        submitted_date: isoDate(submitted),
        amount_billed: formatCents(billedCents),
        amount_outstanding: formatCents(outstandingCents),
        expected_amount: formatCents(expectedCents),
        days_outstanding: String(days),
      },
      context: {
        patientFirstName: name.first,
        patientLastName: name.last,
        dateOfBirth: dob,
        memberId,
        claimNumber,
      },
    });
  }
  return records;
}
