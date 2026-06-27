/** Shared recovery route labels and badge colors for list + detail UI. */

export const CARRIER_LABELS: Record<string, string> = {
  sun_life: 'Sun Life',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield',
  rbc: 'RBC Insurance',
  telus_adjudicare: 'TELUS AdjudiCare',
};

export function carrierLabel(carrierId: string): string {
  return CARRIER_LABELS[carrierId] ?? carrierId.replace(/_/g, ' ');
}

export const CLAIM_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  IN_QUEUE: 'In queue',
  IN_PROGRESS: 'In progress',
  CALLING: 'Calling',
  APPROVED_PENDING_PAYMENT: 'Approved',
  ESCALATED: 'Escalated',
  ON_HOLD: 'On hold',
  DENIED: 'Denied',
  RESOLVED: 'Resolved',
  BLOCKED: 'Blocked',
};

export function claimStatusLabel(status: string): string {
  return CLAIM_STATUS_LABELS[status] ?? status;
}

export const OUTCOME_LABELS: Record<string, string> = {
  RESOLVED: 'Resolved',
  DENIED: 'Denied',
  ESCALATED: 'Escalated, needs your call',
  PENDING: 'Pending',
  BLOCK_DETECTED: 'Carrier block detected',
  FAILED: 'Call failed',
  NO_ANSWER: 'No answer',
  HUNG_UP: 'Call ended unexpectedly',
  APPROVED_PENDING_PAYMENT: 'Approved, awaiting payment',
};

export function callOutcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return 'In progress';
  return OUTCOME_LABELS[outcome] ?? outcome;
}

/** One-line summary for claim list rows (label + short detail). */
export function lastOutcomeLine(
  outcome: string | null | undefined,
  outcomeDetail: string | null | undefined,
): string {
  if (!outcome) return outcomeDetail ? outcomeDetail.slice(0, 80) : 'No calls yet';
  const label = callOutcomeLabel(outcome);
  if (!outcomeDetail) return label;
  const detail =
    outcomeDetail.length > 60 ? `${outcomeDetail.slice(0, 57)}…` : outcomeDetail;
  return `${label} — ${detail}`;
}

/** Demo / seed calls use vapiCallId prefix `demo-`. */
export function isDemoVapiCall(vapiCallId: string | null | undefined): boolean {
  return Boolean(vapiCallId?.startsWith('demo-'));
}

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
  if (!iso) return 'N/A';
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
    return 'Claim is under 30 days, calls start at day 31.';
  }
  if (raw.includes('90 days') || raw.includes('escalate')) {
    return 'Over 90 days, escalated for human follow-up.';
  }
  if (raw.includes('3 attempt') || raw.includes('max attempt')) {
    return 'Maximum 3 call attempts reached.';
  }
  if (raw.includes('business hours') || raw.includes('outside')) {
    return 'Calls only Mon–Fri 8am–5pm Eastern.';
  }
  if (raw.includes('CARRIER_BLOCK') || raw.includes('blocked')) {
    return 'Carrier blocked, unblock in Settings.';
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

export function outcomeColor(outcome: string | null): string {
  if (!outcome) return 'text-gray-500';
  if (outcome === 'RESOLVED' || outcome === 'APPROVED_PENDING_PAYMENT') {
    return 'text-green-700 dark:text-green-400';
  }
  if (outcome === 'ESCALATED') return 'text-amber-700 dark:text-amber-400';
  if (outcome === 'DENIED' || outcome === 'BLOCK_DETECTED') {
    return 'text-red-700 dark:text-red-400';
  }
  return 'text-gray-600 dark:text-gray-400';
}

export function fmtRecoveryEventType(type: string): string {
  switch (type) {
    case 'PAYMENT_VERIFIED_SYNC':
      return 'Payment verified (PMS sync)';
    case 'PARTIAL_PAYMENT_SYNC':
      return 'Partial payment (PMS sync)';
    case 'ROUTE_ASSIGNED':
      return 'Recovery route assigned';
    default:
      return type.replace(/_/g, ' ').toLowerCase();
  }
}

export function fmtCallDuration(seconds: number | null): string | null {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function recallDueLabelDetailed(iso: string | null | undefined): string {
  if (!iso) return 'Not scheduled';
  const t = new Date(iso).getTime();
  const diff = t - Date.now();
  const formatted = new Date(iso).toLocaleString();
  if (diff <= 0) return `Due now (${formatted})`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 48) return `In ~${hours}h (${formatted})`;
  const days = Math.round(hours / 24);
  return `In ~${days}d (${formatted})`;
}

export interface NextActionSummary {
  headline: string;
  detail: string | null;
  variant: 'default' | 'warning' | 'success' | 'blocked';
}

export function buildNextActionSummary(input: {
  isEscalated: boolean;
  recovery: {
    recoveryRoute?: string | null;
    routeLabel: string;
    routeDescription: string;
    stopCalling: boolean;
    scheduledRecallAt: string | null;
    dispatchBlockReason: string | null;
    paymentExpectedBy: string | null;
    openActions: Array<{ blocking: boolean; title: string; detail: string | null }>;
  } | null;
  queueScheduledFor: string | null;
}): NextActionSummary {
  const { isEscalated, recovery, queueScheduledFor } = input;

  if (isEscalated) {
    return {
      headline: 'Your call required',
      detail:
        'CollectRx reached the carrier but needs you to finish with a supervisor, appeals, or written dispute.',
      variant: 'warning',
    };
  }

  const blockingGate = recovery?.openActions.find((a) => a.blocking);
  if (blockingGate) {
    return {
      headline: blockingGate.title,
      detail: blockingGate.detail ?? 'Complete this step so CollectRx can call the carrier again.',
      variant: 'warning',
    };
  }

  if (recovery?.dispatchBlockReason) {
    return {
      headline: 'Carrier call paused',
      detail: recovery.dispatchBlockReason,
      variant: 'blocked',
    };
  }

  if (recovery?.paymentExpectedBy && recovery.recoveryRoute === 'WAIT_SYNC') {
    return {
      headline: 'Waiting for PMS payment sync',
      detail: `If the balance is still open after ${new Date(recovery.paymentExpectedBy).toLocaleDateString()}, CollectRx will trace with the carrier.`,
      variant: 'default',
    };
  }

  if (recovery?.stopCalling) {
    return {
      headline: recovery.routeLabel,
      detail: recovery.routeDescription || 'No automated carrier calls are scheduled.',
      variant: recovery.recoveryRoute === 'STOP' ? 'success' : 'default',
    };
  }

  const recallAt = recovery?.scheduledRecallAt ?? queueScheduledFor;
  if (recallAt) {
    return {
      headline: `CollectRx will call again at ${new Date(recallAt).toLocaleString()}`,
      detail: recallDueLabelDetailed(recallAt),
      variant: 'default',
    };
  }

  if (recovery) {
    return {
      headline: recovery.routeLabel,
      detail: recovery.routeDescription,
      variant: 'default',
    };
  }

  if (queueScheduledFor) {
    return {
      headline: 'CollectRx will call the carrier',
      detail: `Queued for ${new Date(queueScheduledFor).toLocaleString()}`,
      variant: 'default',
    };
  }

  return {
    headline: 'CollectRx is monitoring this claim',
    detail: null,
    variant: 'default',
  };
}
