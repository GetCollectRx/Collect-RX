import type { AuthJwtPayload } from './types.js';
import { isPlatformDev } from './types.js';

/** Mask claim numbers for platform dev (keep last segment for support correlation). */
export function maskClaimNumber(claimNumber: string): string {
  const s = String(claimNumber ?? '').trim();
  if (!s) return '[redacted]';
  const parts = s.split(/[-/]/);
  const tail = parts[parts.length - 1] ?? s;
  const suffix = tail.length > 4 ? tail.slice(-4) : tail;
  return `***-${suffix}`;
}

export function redactInsuranceClaim<T extends Record<string, unknown>>(
  claim: T,
  auth: AuthJwtPayload | undefined,
): T {
  if (!isPlatformDev(auth)) return claim;
  const { patientToken: _pt, ...rest } = claim;
  return {
    ...rest,
    claimNumber: maskClaimNumber(String(claim.claimNumber ?? '')),
    patientToken: null,
  } as T;
}

export function redactInsuranceClaimsList<T extends Record<string, unknown>>(
  claims: T[],
  auth: AuthJwtPayload | undefined,
): T[] {
  if (!isPlatformDev(auth)) return claims;
  return claims.map((c) => redactInsuranceClaim(c, auth));
}

export function redactWorkItemTitle(
  item: { sourceType?: string; title?: string | null },
  auth: AuthJwtPayload | undefined,
): string | null | undefined {
  if (!isPlatformDev(auth)) return item.title;
  if (item.sourceType === 'insurance_claim') return 'Insurance claim (PHI redacted)';
  return 'Work item (PHI redacted)';
}

export function redactWorkItem<T extends Record<string, unknown>>(
  item: T,
  auth: AuthJwtPayload | undefined,
): T {
  if (!isPlatformDev(auth)) return item;
  return {
    ...item,
    title: redactWorkItemTitle(
      { sourceType: item.sourceType as string | undefined, title: item.title as string | null },
      auth,
    ),
    notes: item.notes != null ? '[redacted]' : item.notes,
  };
}

export function redactDashboardRecentPayment<T extends { patientLabel?: string }>(
  row: T,
  auth: AuthJwtPayload | undefined,
): T {
  if (!isPlatformDev(auth)) return row;
  return { ...row, patientLabel: 'Payment (PHI redacted)' };
}

export function redactPriorityScoreRow<T extends { patientName?: string }>(
  row: T,
  auth: AuthJwtPayload | undefined,
): T {
  if (!isPlatformDev(auth)) return row;
  return { ...row, patientName: '[redacted]' };
}
