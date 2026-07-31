import { Badge } from './ui'

export type RecoveryVerification = 'sync_verified' | 'carrier_confirmed' | 'in_progress' | 'at_risk'

const CONFIG: Record<
  RecoveryVerification,
  { label: string; color: 'green' | 'amber' | 'blue' | 'red' | undefined; hint: string }
> = {
  sync_verified: {
    label: 'Sync-verified',
    color: 'green',
    hint: 'PMS balance cleared — recovery confirmed in your practice system',
  },
  carrier_confirmed: {
    label: 'Carrier confirmed',
    color: 'amber',
    hint: 'Carrier reported payment — awaiting PMS sync to verify',
  },
  in_progress: {
    label: 'In progress',
    color: 'blue',
    hint: 'Call scheduled or active — not yet recovered',
  },
  at_risk: {
    label: 'At risk',
    color: 'red',
    hint: 'Blocked gate, denial, or carrier hold — needs staff action',
  },
}

export function RecoveryBadge({
  verification,
  className,
}: {
  verification: RecoveryVerification
  className?: string
}) {
  const c = CONFIG[verification]
  return (
    <span className={className} title={c.hint}>
      <Badge color={c.color}>{c.label}</Badge>
    </span>
  )
}

export function recoveryVerificationFromClaim(input: {
  dollarsRecoveredSyncVerified?: number
  hasOpenBlockingGate?: boolean
  status?: string
  paymentExpectedBy?: string | null
}): RecoveryVerification {
  if (input.hasOpenBlockingGate || input.status === 'BLOCKED' || input.status === 'ESCALATED') {
    return 'at_risk'
  }
  if ((input.dollarsRecoveredSyncVerified ?? 0) > 0) return 'sync_verified'
  if (input.status === 'APPROVED_PENDING_PAYMENT' || input.paymentExpectedBy) return 'carrier_confirmed'
  return 'in_progress'
}
