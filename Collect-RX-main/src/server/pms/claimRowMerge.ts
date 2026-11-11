import type { NormalizedPmsClaimRow } from './parseExportRows.js';

/**
 * Many PMS exports are line-level: one row per procedure, several rows sharing
 * one claim number. The importer keys claims on (practiceId, claimNumber), so
 * importing those rows one at a time made each row overwrite the last row's
 * balance, and the drop between two lines of the same claim was recorded as a
 * partial insurance payment that never happened.
 *
 * mergeClaimRows collapses rows that share a claim number into one claim-level
 * row before anything is written. Single-row claims pass through unchanged.
 */

export interface ClaimRowConflict {
  claimNumber: string;
  rowCount: number;
  error: string;
}

export interface MergedClaimRows {
  rows: NormalizedPmsClaimRow[];
  conflicts: ClaimRowConflict[];
  /** How many export rows each merged claim came from, so row-count checks still reconcile. */
  sourceRowCount: Map<string, number>;
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function sumNullable(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((s, v) => s + v, 0) : null;
}

function earliest(values: (Date | null)[]): Date | null {
  const present = values.filter((d): d is Date => d != null);
  if (!present.length) return null;
  return present.reduce((a, b) => (b.getTime() < a.getTime() ? b : a));
}

function firstPresent<T>(values: (T | null)[]): T | null {
  for (const v of values) {
    if (v != null && v !== '') return v;
  }
  return null;
}

function mergedCodes(group: NormalizedPmsClaimRow[]): string | null {
  const codes = new Set<string>();
  for (const row of group) {
    for (const part of (row.treatmentCodes ?? '').split(/[,;|\s]+/)) {
      if (part.trim()) codes.add(part.trim());
    }
    if (row.procedureCode.trim()) codes.add(row.procedureCode.trim());
  }
  return codes.size ? [...codes].join(',') : null;
}

function conflictIn(group: NormalizedPmsClaimRow[]): string | null {
  const carriers = new Set(group.map((r) => norm(r.carrierName)));
  if (carriers.size > 1) {
    return `Rows for this claim name different carriers (${[...carriers].join(', ')}). Fix the export and re-import; claim not imported.`;
  }
  const dentists = new Set(
    group.map((r) => norm(r.treatingDentistProviderNumber)).filter((v) => v !== ''),
  );
  if (dentists.size > 1) {
    return 'Rows for this claim name different treating dentists. Fix the export and re-import; claim not imported.';
  }
  return null;
}

function mergeGroup(group: NormalizedPmsClaimRow[]): NormalizedPmsClaimRow {
  const first = group[0];
  return {
    ...first,
    billedAmount: group.reduce((s, r) => s + r.billedAmount, 0),
    outstandingAmount: group.reduce((s, r) => s + r.outstandingAmount, 0),
    expectedAmount: sumNullable(group.map((r) => r.expectedAmount)),
    insurancePaidAmount: sumNullable(group.map((r) => r.insurancePaidAmount)),
    daysOutstanding: Math.max(...group.map((r) => r.daysOutstanding)),
    servicedAt: earliest(group.map((r) => r.servicedAt)),
    submittedAt: earliest(group.map((r) => r.submittedAt)),
    treatmentCodes: mergedCodes(group),
    transactionType: group.some((r) => r.transactionType?.toUpperCase() === 'T11')
      ? 'T11'
      : firstPresent(group.map((r) => r.transactionType)),
    denialReasonCode: firstPresent(group.map((r) => r.denialReasonCode)),
    treatingDentistProviderNumber: firstPresent(group.map((r) => r.treatingDentistProviderNumber)),
    patientDob: firstPresent(group.map((r) => r.patientDob)),
    subscriberId: firstPresent(group.map((r) => r.subscriberId)),
    groupPolicyNumber: firstPresent(group.map((r) => r.groupPolicyNumber)),
    subscriberName: firstPresent(group.map((r) => r.subscriberName)),
    subscriberDateOfBirth: firstPresent(group.map((r) => r.subscriberDateOfBirth)),
    relationship: firstPresent(group.map((r) => r.relationship)),
  };
}

export function mergeClaimRows(rows: NormalizedPmsClaimRow[]): MergedClaimRows {
  const groups = new Map<string, NormalizedPmsClaimRow[]>();
  for (const row of rows) {
    const list = groups.get(row.claimNumber);
    if (list) list.push(row);
    else groups.set(row.claimNumber, [row]);
  }

  const merged: NormalizedPmsClaimRow[] = [];
  const conflicts: ClaimRowConflict[] = [];
  const sourceRowCount = new Map<string, number>();
  for (const [claimNumber, group] of groups) {
    sourceRowCount.set(claimNumber, group.length);
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const conflict = conflictIn(group);
    if (conflict) {
      conflicts.push({ claimNumber, rowCount: group.length, error: conflict });
      continue;
    }
    merged.push(mergeGroup(group));
  }
  return { rows: merged, conflicts, sourceRowCount };
}
