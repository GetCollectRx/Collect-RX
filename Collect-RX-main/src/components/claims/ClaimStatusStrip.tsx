import { RecoveryBadge, recoveryVerificationFromClaim } from '../RecoveryBadge'
import { Badge } from '../ui'
import { claimStatusLabel, recoveryRouteBadgeColor } from '../../lib/recoveryDisplay'

type ClaimStatusStripProps = {
  claimNumber: string
  carrierId: string
  status: string
  daysOutstanding: number
  outstandingAmount: number | string
  recoveryRoute?: string | null
  dollarsRecoveredSyncVerified?: number
  hasOpenBlockingGate?: boolean
  paymentExpectedBy?: string | null
}

export function ClaimStatusStrip({
  claimNumber,
  carrierId,
  status,
  daysOutstanding,
  outstandingAmount,
  recoveryRoute,
  dollarsRecoveredSyncVerified,
  hasOpenBlockingGate,
  paymentExpectedBy,
}: ClaimStatusStripProps) {
  const verification = recoveryVerificationFromClaim({
    dollarsRecoveredSyncVerified,
    hasOpenBlockingGate,
    status,
    paymentExpectedBy,
  })
  const outstanding = Number(outstandingAmount)

  return (
    <div className="crx-claim-status-strip rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-wrap items-center gap-4">
      <div className="flex-1 min-w-[200px]">
        <p className="text-xs uppercase tracking-wide text-gray-500">Claim status</p>
        <p className="text-lg font-semibold font-mono mt-0.5">{claimNumber}</p>
        <p className="text-sm text-gray-600 mt-0.5">
          {carrierId} · {daysOutstanding} days outstanding
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs text-gray-500">Outstanding</p>
        <p className="text-xl font-semibold tabular-nums">
          ${outstanding.toFixed(2)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{claimStatusLabel(status)}</Badge>
        {recoveryRoute && (
          <Badge color={recoveryRouteBadgeColor(recoveryRoute)}>{recoveryRoute}</Badge>
        )}
        <RecoveryBadge verification={verification} />
      </div>
    </div>
  )
}
