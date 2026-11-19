/**
 * Carrier identifiers and conservative procedure categorization.
 *
 * Benefit percentages, deductibles, annual maximums, waiting periods, and
 * frequency limits are member-plan facts. They must come from a verified,
 * effective-dated eligibility response or plan document; CollectRx does not
 * provide invented carrier-wide defaults. CDCP established fees likewise
 * come from the official effective-dated benefit grid and are independent of
 * provincial association fee guides.
 */

export interface CarrierRuleConfig {
  carrierCode: string;
  carrierName: string;
  version: string;
  source: 'verified-plan-data-required';
}

export const VALID_CARRIER_CODES = [
  'cdcp',
  'sun_life',
  'manulife',
  'canada_life',
  'green_shield',
  'rbc_insurance',
  'telus_adjudicare',
] as const;

const CARRIER_NAMES: Record<(typeof VALID_CARRIER_CODES)[number], string> = {
  cdcp: 'Canadian Dental Care Plan (administered by Sun Life)',
  sun_life: 'Sun Life',
  manulife: 'Manulife',
  canada_life: 'Canada Life',
  green_shield: 'GreenShield',
  rbc_insurance: 'RBC Insurance',
  telus_adjudicare: 'TELUS AdjudiCare',
};

export function getCarrierRule(carrierCode: string): CarrierRuleConfig | null {
  if (!VALID_CARRIER_CODES.includes(carrierCode as (typeof VALID_CARRIER_CODES)[number])) return null;
  const code = carrierCode as (typeof VALID_CARRIER_CODES)[number];
  return {
    carrierCode: code,
    carrierName: CARRIER_NAMES[code],
    version: 'verification-required',
    source: 'verified-plan-data-required',
  };
}

/**
 * Disabled until a current official, effective-dated CDCP benefit grid is
 * configured. A provincial association fee cannot be converted into a CDCP
 * established fee with a generic percentage.
 */
export function getCdcpFeeCeiling(_baseFee: number, _provinceCode: string): never {
  throw new Error('CDCP fee schedule is not configured from an official effective-dated source');
}

/** Disabled: fee-guide changes must be supplied as verified source data. */
export function apply2026FeeGuide(_baseFee: number, _provinceCode: string): never {
  throw new Error('Provincial fee-guide estimates are disabled pending verified source data');
}

/**
 * Coarse procedure family only. This does not state that a procedure is
 * covered; actual coverage remains plan/member/service-date specific.
 */
export function getCdtCoverageCategory(
  cdtCode: string,
): 'preventive' | 'basic' | 'major' | 'orthodontic' | 'not_covered' {
  const match = cdtCode.match(/^D(\d{4})$/);
  if (!match) return 'not_covered';

  const seriesDigit = Number.parseInt(match[1][0], 10);
  switch (seriesDigit) {
    case 0:
    case 1:
      return 'preventive';
    case 2:
    case 3:
    case 4:
    case 7:
    case 9:
      return 'basic';
    case 5:
    case 6:
      return 'major';
    case 8:
      return 'orthodontic';
    default:
      return 'not_covered';
  }
}
