/** Shared recovery route labels and badge colors for list + detail UI. */

export const RECOVERY_ROUTE_LABELS: Record<string, string> = {
  CALL_CARRIER: 'Call carrier',
  WAIT_SYNC: 'Await sync',
  OPEN_CDCP: 'CDCP',
  PRACTICE_GATE: 'Gate open',
  STOP: 'Closed',
};

export function recoveryRouteBadgeColor(
  route: string | null | undefined,
): 'green' | 'amber' | 'blue' | 'gray' | undefined {
  switch (route) {
    case 'CALL_CARRIER':
      return 'blue';
    case 'WAIT_SYNC':
      return 'amber';
    case 'OPEN_CDCP':
      return undefined;
    case 'PRACTICE_GATE':
      return 'amber';
    case 'STOP':
      return 'green';
    default:
      return 'gray';
  }
}

export function recallDueLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  const diff = t - Date.now();
  if (diff <= 0) return 'Due now';
  const hours = Math.round(diff / 3_600_000);
  if (hours < 48) return `~${hours}h`;
  const days = Math.round(hours / 24);
  return `~${days}d`;
}

export function mapTriggerCallError(raw: string): string {
  if (raw.includes('30 days') || raw.includes('too recent')) {
    return 'Claim is under 30 days — calls start at day 31.';
  }
  if (raw.includes('90 days') || raw.includes('escalate')) {
    return 'Over 90 days — escalated for human follow-up.';
  }
  if (raw.includes('3 attempt') || raw.includes('max attempt')) {
    return 'Maximum 3 call attempts reached.';
  }
  if (raw.includes('business hours') || raw.includes('outside')) {
    return 'Calls only Mon–Fri 8am–5pm Eastern.';
  }
  if (raw.includes('CARRIER_BLOCK') || raw.includes('blocked')) {
    return 'Carrier blocked — unblock in Settings.';
  }
  if (raw.includes('already') || raw.includes('CALLING')) {
    return 'Call already in progress.';
  }
  if (
    raw.includes('Recovery route') ||
    raw.includes('recovery action') ||
    raw.includes('Practice gate') ||
    raw.includes('Blocking recovery')
  ) {
    return raw;
  }
  if (raw.includes('Re-call scheduled')) {
    return raw;
  }
  return raw;
}
