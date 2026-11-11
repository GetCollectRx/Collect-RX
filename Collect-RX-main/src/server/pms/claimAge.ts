const DAY_MS = 86_400_000;

interface ClaimAgeInput {
  daysOutstanding: number;
  submittedAt: Date | null;
  servicedAt: Date | null;
}

/**
 * Days a claim has waited on the carrier. An export that states the age wins.
 * Otherwise the carrier's clock starts at submission, not at treatment, so the
 * submission date is used and the service date is only a fallback for exports
 * that carry no submission date. This number gates calling (too young under 30,
 * escalate over 90), so a claim treated long ago but submitted last week must
 * not be aged from the treatment date.
 */
export function deriveDaysOutstanding(row: ClaimAgeInput, now: Date): number {
  if (row.daysOutstanding > 0) return row.daysOutstanding;
  const start = row.submittedAt ?? row.servicedAt;
  if (!start) return 0;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / DAY_MS));
}
