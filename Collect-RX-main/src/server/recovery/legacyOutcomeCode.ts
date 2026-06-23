import type { LegacyOutcomeCode } from './types.js';

const LEGACY_RE = /\(legacy:\s*([a-z_]+)\)/i;

/** Pull legacy classifier code embedded in `outcomeDetail` by the outcome processor. */
export function extractLegacyOutcomeCode(detail: string | null | undefined): LegacyOutcomeCode {
  if (!detail) return null;
  const m = detail.match(LEGACY_RE);
  if (!m?.[1]) return null;
  const code = m[1].toLowerCase();
  switch (code) {
    case 'paid':
    case 'processing':
    case 'resubmit_required':
    case 'xray_required':
    case 'docs_required':
    case 'coverage_maxed':
    case 'not_covered':
    case 'appeal_required':
    case 'no_answer':
    case 'carrier_block':
      return code;
    default:
      return null;
  }
}

export function isCdcpCarrierContext(carrierId: string, detail: string | null | undefined): boolean {
  if (carrierId !== 'sun_life') return false;
  const d = (detail ?? '').toLowerCase();
  return (
    d.includes('cdcp') ||
    d.includes('canadian dental care plan') ||
    d.includes('transaction 11') ||
    d.includes('t11') ||
    d.includes('predetermination')
  );
}
