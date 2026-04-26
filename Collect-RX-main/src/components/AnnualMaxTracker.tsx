import { useMemo } from 'react';

/**
 * AnnualMaxTracker — Visual display of annual maximum usage
 */

interface AnnualMaxTrackerProps {
  annualMax?: number | null;
  annualMaxUsed?: number | null;
  pendingClaims?: number;
  planYearEnd?: string | null;
  staleFlag?: boolean;
}

function fmtCurrency(v: number | null | undefined): string {
  return v != null
    ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v)
    : '$0.00';
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const end = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

export default function AnnualMaxTracker({
  annualMax = 0,
  annualMaxUsed = 0,
  pendingClaims = 0,
  planYearEnd = null,
  staleFlag = false,
}: AnnualMaxTrackerProps) {
  const max = annualMax || 0;
  const used = annualMaxUsed || 0;
  const pending = pendingClaims || 0;

  const remaining = Math.max(0, max - used - pending);
  const usedPct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const pendingPct = max > 0 ? Math.min(100 - usedPct, (pending / max) * 100) : 0;

  const daysLeft = useMemo(() => daysUntil(planYearEnd), [planYearEnd]);

  const usageLevel = usedPct + pendingPct;
  const barColor = usageLevel >= 90 ? 'bg-red-500' : usageLevel >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  const pendingColor = 'bg-amber-300';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Annual Maximum</h3>
          {staleFlag && (
            <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
              Data may be outdated
            </span>
          )}
        </div>
        {daysLeft !== null && (
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase">Plan year ends</p>
            <p className={`text-sm font-semibold ${daysLeft <= 30 ? 'text-amber-600' : 'text-gray-600'}`}>
              {daysLeft} day{daysLeft !== 1 ? 's' : ''} left
            </p>
          </div>
        )}
      </div>

      {/* Main amount display */}
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-3xl font-bold text-gray-900">{fmtCurrency(remaining)}</span>
        <span className="text-sm text-gray-500">remaining of {fmtCurrency(max)}</span>
      </div>

      {/* Progress bar */}
      <div className="h-4 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div className="h-full flex">
          {usedPct > 0 && (
            <div
              className={`${barColor} transition-all duration-500`}
              style={{ width: `${usedPct}%` }}
              title={`Used: ${fmtCurrency(used)}`}
            />
          )}
          {pendingPct > 0 && (
            <div
              className={`${pendingColor} transition-all duration-500`}
              style={{ width: `${pendingPct}%` }}
              title={`Pending: ${fmtCurrency(pending)}`}
            />
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className={`w-3 h-3 rounded-sm ${barColor}`} />
          <span className="text-gray-600">Used: {fmtCurrency(used)}</span>
        </div>
        {pending > 0 && (
          <div className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-sm ${pendingColor}`} />
            <span className="text-gray-600">Pending: {fmtCurrency(pending)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-gray-100 border border-gray-200" />
          <span className="text-gray-600">Remaining: {fmtCurrency(remaining)}</span>
        </div>
      </div>

      {/* Warnings */}
      {usageLevel >= 90 && (
        <div className="mt-4 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
          <p className="text-xs text-red-700 font-medium">
            {usageLevel >= 100
              ? 'Annual maximum has been reached. Additional treatment will be patient responsibility.'
              : 'Annual maximum is nearly exhausted. Consider treatment timing.'}
          </p>
        </div>
      )}
    </div>
  );
}
