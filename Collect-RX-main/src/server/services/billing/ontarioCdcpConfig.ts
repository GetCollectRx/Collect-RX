/**
 * Ontario CDCP / Accerta coordination rules — data, not code, per the same
 * "carrier rules are data" principle as src/services/eligibility/rules/carrier-configs.json.
 * This is a separate file rather than an addition to carrier-configs.json:
 * that file is keyed by CarrierId and consumed by the eligibility engine with
 * a coveragePercent/deductible/annualMax shape that these CDCP/Accerta rules
 * don't fit.
 *
 * Figures verified 2026-09-05 against:
 * - Canada.ca, "Coordination of benefits between the CDCP and Ontario's
 *   provincial dental programs" (fact sheet for providers)
 * - Canada.ca, "Canadian Dental Care Plan: Examples of co-payments and
 *   additional charges"
 * Re-verify before changing — these drive what patients are actually charged.
 */

export type CdcpCoPayTier = 0 | 40 | 60;

interface CdcpIncomeTier {
  minIncome: number;
  maxIncome: number;
  coPayTier: CdcpCoPayTier;
}

/** Adjusted family net income (AFNI) bands, in whole CAD dollars. */
export const CDCP_INCOME_COPAY_TIERS: readonly CdcpIncomeTier[] = [
  { minIncome: 0, maxIncome: 69_999, coPayTier: 0 },
  { minIncome: 70_000, maxIncome: 79_999, coPayTier: 40 },
  { minIncome: 80_000, maxIncome: 89_999, coPayTier: 60 },
];

/** AFNI at or above this is not eligible for CDCP. */
export const CDCP_INCOME_INELIGIBLE_THRESHOLD = 90_000;

/**
 * Resolves a patient's CDCP co-pay tier from their adjusted family net
 * income. Returns null when the income is at or above the CDCP eligibility
 * ceiling — callers must treat that as "not CDCP-eligible," not "0% co-pay."
 */
export function resolveCdcpCoPayTier(adjustedFamilyNetIncome: number): CdcpCoPayTier | null {
  if (!Number.isFinite(adjustedFamilyNetIncome) || adjustedFamilyNetIncome < 0) {
    throw new Error(`Invalid adjusted family net income: ${adjustedFamilyNetIncome}`);
  }
  if (adjustedFamilyNetIncome >= CDCP_INCOME_INELIGIBLE_THRESHOLD) {
    return null;
  }
  const tier = CDCP_INCOME_COPAY_TIERS.find(
    (t) => adjustedFamilyNetIncome >= t.minIncome && adjustedFamilyNetIncome <= t.maxIncome,
  );
  return tier?.coPayTier ?? null;
}

/**
 * Accerta (Ontario's third-party administrator for ODSP, Ontario Works, and
 * Healthy Smiles Ontario) requires the CDCP EOB submitted as a secondary
 * claim within this many days to preserve the coordination window.
 */
export const ACCERTA_SECONDARY_FILING_WINDOW_DAYS = 30;

/** Secondary carrier name used on CobRoute records for Ontario provincial coordination. */
export const ACCERTA_SECONDARY_CARRIER_NAME = 'Accerta';
