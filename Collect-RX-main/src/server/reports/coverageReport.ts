import { mapToCarrierId } from '../pms/carrierMap.js';

export interface CoverageRow {
  carrierName: string | null | undefined;
  outstandingAmount: number;
}

export interface CoverageReport {
  totalClaims: number;
  totalAmount: number;
  supportedClaims: number;
  supportedAmount: number;
  supportedShareByCount: number; // 0..1
  supportedShareByAmount: number; // 0..1
  byCarrier: Record<string, { claims: number; amount: number }>;
  unsupported: Array<{ name: string; claims: number; amount: number }>;
}

/**
 * Share of a practice's outstanding AR that sits with the six carriers we can
 * call (B-17). Run on a CSV export before signup so the answer is known first.
 */
export function buildCoverageReport(rows: CoverageRow[]): CoverageReport {
  const byCarrier: CoverageReport['byCarrier'] = {};
  const unsupportedMap = new Map<string, { claims: number; amount: number }>();
  let supportedClaims = 0;
  let supportedAmount = 0;
  let totalAmount = 0;

  for (const r of rows) {
    const amt = Number.isFinite(r.outstandingAmount) ? r.outstandingAmount : 0;
    totalAmount += amt;
    const id = mapToCarrierId(r.carrierName ?? null);
    if (id) {
      supportedClaims++;
      supportedAmount += amt;
      const c = (byCarrier[id] ??= { claims: 0, amount: 0 });
      c.claims++;
      c.amount += amt;
    } else {
      const name = (r.carrierName ?? '').trim() || '(blank)';
      const u = unsupportedMap.get(name) ?? { claims: 0, amount: 0 };
      u.claims++;
      u.amount += amt;
      unsupportedMap.set(name, u);
    }
  }
  const unsupported = [...unsupportedMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.amount - a.amount);
  return {
    totalClaims: rows.length,
    totalAmount,
    supportedClaims,
    supportedAmount,
    supportedShareByCount: rows.length ? supportedClaims / rows.length : 0,
    supportedShareByAmount: totalAmount ? supportedAmount / totalAmount : 0,
    byCarrier,
    unsupported,
  };
}
