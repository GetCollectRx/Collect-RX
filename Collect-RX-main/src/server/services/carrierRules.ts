/**
 * Phase 3 + Phase 5: Canadian Carrier Rule Configs
 * All 6 supported private carriers + CDCP (federal program).
 *
 * Phase 5 additions:
 *  - cdcp carrier entry (Sun Life as administrator)
 *  - 2026 provincial fee guide multipliers per province
 *  - CDCP fee grid ceiling to prevent balance billing
 *
 * Rules sourced from carrier benefit booklets — update annually.
 */

export interface CarrierRuleConfig {
  carrierCode: string;
  carrierName: string;
  version: string;
  deductible: { single: number; family: number };
  annualMax: { single: number; family: number };
  coverage: {
    preventive: number;   // % of eligible fee
    basic: number;
    major: number;
    orthodontic: number;
  };
  orthodonticLifetimeMax?: number;
  waitingPeriods: {
    preventive: number;   // months
    basic: number;
    major: number;
  };
  frequency: {
    cleaningMonths: number;       // how often a cleaning is covered
    examMonths: number;
    xrayBitewingMonths: number;
    xrayFullSeriesMonths: number;
    crownMonths: number;
    sealantAgeLimit?: number;     // max patient age
  };
  // Phase 5: CDCP-specific fields
  isFederalProgram?: boolean;
  cdcpFeeGridCeilingPct?: number;  // CDCP reimbursement as % of provincial guide (typically 88–95%)
  preAuthRequired?: boolean;        // CDCP requires Transaction 11 pre-auth
  reconsiderationWindowDays?: number;
  notes?: string;
}

// ─── Phase 5: 2026 Provincial Fee Guide Multipliers ──────────────────────────

export interface ProvincialFeeGuide2026 {
  province: string;
  provinceCode: string;
  incrementPct: number;         // % increase over 2025 guide
  multiplier: number;           // 1 + (incrementPct / 100)
  cdcpReimbursementPct: number; // CDCP pays this % of the provincial guide
  cdcpCeilingMultiplier: number; // provincial multiplier × cdcpReimbursementPct / 100
  effectiveDate: string;
  notes: string;
}

export const PROVINCIAL_FEE_GUIDES_2026: Record<string, ProvincialFeeGuide2026> = {
  AB: {
    province: 'Alberta',
    provinceCode: 'AB',
    incrementPct: 4.5,
    multiplier: 1.045,
    cdcpReimbursementPct: 90,    // midpoint of 88–95% range
    cdcpCeilingMultiplier: 1.045 * 0.90,
    effectiveDate: '2026-01-01',
    notes: 'Alberta Dental Association 2026 fee guide. Highest increase this cycle.',
  },
  ON: {
    province: 'Ontario',
    provinceCode: 'ON',
    incrementPct: 3.32,
    multiplier: 1.0332,
    cdcpReimbursementPct: 90,
    cdcpCeilingMultiplier: 1.0332 * 0.90,
    effectiveDate: '2026-01-01',
    notes: 'Ontario Dental Association 2026 fee guide.',
  },
  BC: {
    province: 'British Columbia',
    provinceCode: 'BC',
    incrementPct: 2.66,
    multiplier: 1.0266,
    cdcpReimbursementPct: 88,    // BC CDCP ceiling is slightly lower
    cdcpCeilingMultiplier: 1.0266 * 0.88,
    effectiveDate: '2026-01-01',
    notes: 'BC Dental Association 2026 fee guide.',
  },
  QC: {
    province: 'Quebec',
    provinceCode: 'QC',
    incrementPct: 3.0,           // placeholder — confirm with OAQ
    multiplier: 1.030,
    cdcpReimbursementPct: 90,
    cdcpCeilingMultiplier: 1.030 * 0.90,
    effectiveDate: '2026-01-01',
    notes: 'OAQ 2026 fee guide. Verify final increment when published.',
  },
  MB: {
    province: 'Manitoba',
    provinceCode: 'MB',
    incrementPct: 3.0,
    multiplier: 1.030,
    cdcpReimbursementPct: 90,
    cdcpCeilingMultiplier: 1.030 * 0.90,
    effectiveDate: '2026-01-01',
    notes: 'MDA 2026 fee guide.',
  },
  SK: {
    province: 'Saskatchewan',
    provinceCode: 'SK',
    incrementPct: 3.0,
    multiplier: 1.030,
    cdcpReimbursementPct: 90,
    cdcpCeilingMultiplier: 1.030 * 0.90,
    effectiveDate: '2026-01-01',
    notes: 'SDA 2026 fee guide.',
  },
};

/**
 * Returns the CDCP fee grid ceiling for a given province.
 * This is the maximum amount CDCP will reimburse — providers cannot
 * balance-bill patients above this ceiling (illegal under CDCP terms).
 */
export function getCdcpFeeCeiling(baseFee: number, provinceCode: string): number {
  const guide = PROVINCIAL_FEE_GUIDES_2026[provinceCode];
  if (!guide) return baseFee * 0.90; // default 90% of base fee if province not found
  return baseFee * guide.cdcpCeilingMultiplier;
}

/**
 * Returns the 2026 provincial fee for a given base (2025) fee.
 */
export function apply2026FeeGuide(baseFee: number, provinceCode: string): number {
  const guide = PROVINCIAL_FEE_GUIDES_2026[provinceCode];
  if (!guide) return baseFee;
  return baseFee * guide.multiplier;
}

export const CARRIER_RULES: Record<string, CarrierRuleConfig> = {
  // ─── Phase 5: CDCP (Federal Program — administered by Sun Life) ────────────
  cdcp: {
    carrierCode: 'cdcp',
    carrierName: 'Canadian Dental Care Plan (Sun Life)',
    version: '2026',
    deductible: { single: 0, family: 0 },
    annualMax: { single: 1400, family: 1400 },    // CDCP per-enrollee annual max
    coverage: {
      preventive: 100,
      basic: 80,
      major: 50,
      orthodontic: 0,   // orthodontics not covered under CDCP base plan
    },
    orthodonticLifetimeMax: 0,
    waitingPeriods: { preventive: 0, basic: 0, major: 0 },
    frequency: {
      cleaningMonths: 9,      // CDCP: cleaning every 9 months (more restrictive than private)
      examMonths: 12,
      xrayBitewingMonths: 12,
      xrayFullSeriesMonths: 60,
      crownMonths: 60,
      sealantAgeLimit: 17,
    },
    isFederalProgram: true,
    cdcpFeeGridCeilingPct: 90,   // CDCP reimburses ~90% of provincial fee guide
    preAuthRequired: true,        // Transaction 11 mandatory before major procedures
    reconsiderationWindowDays: 60,
    notes: 'CDCP launched 2024. Administered by Sun Life. Pre-auth (T11) required for major procedures. Balance billing above CDCP fee grid is prohibited. Reconsideration via Appendix C Level 1 process. Contact Centre: 1-888-888-8110.',
  },


  sun_life: {
    carrierCode: 'sun_life',
    carrierName: 'Sun Life Financial',
    version: '2025',
    deductible: { single: 50, family: 150 },
    annualMax: { single: 1200, family: 3600 },
    coverage: { preventive: 100, basic: 80, major: 50, orthodontic: 50 },
    orthodonticLifetimeMax: 2500,
    waitingPeriods: { preventive: 0, basic: 3, major: 6 },
    frequency: {
      cleaningMonths: 6,
      examMonths: 6,
      xrayBitewingMonths: 12,
      xrayFullSeriesMonths: 60,
      crownMonths: 60,
      sealantAgeLimit: 17,
    },
    notes: 'Deductible applies to basic and major. Preventive exempt from deductible.',
  },

  manulife: {
    carrierCode: 'manulife',
    carrierName: 'Manulife Financial',
    version: '2025',
    deductible: { single: 50, family: 150 },
    annualMax: { single: 1500, family: 4500 },
    coverage: { preventive: 100, basic: 80, major: 50, orthodontic: 50 },
    orthodonticLifetimeMax: 2500,
    waitingPeriods: { preventive: 0, basic: 3, major: 12 },
    frequency: {
      cleaningMonths: 6,
      examMonths: 6,
      xrayBitewingMonths: 12,
      xrayFullSeriesMonths: 60,
      crownMonths: 60,
      sealantAgeLimit: 17,
    },
    notes: 'Higher annual max. Major has 12-month waiting period.',
  },

  canada_life: {
    carrierCode: 'canada_life',
    carrierName: 'Canada Life',
    version: '2025',
    deductible: { single: 25, family: 75 },
    annualMax: { single: 1000, family: 3000 },
    coverage: { preventive: 100, basic: 70, major: 50, orthodontic: 50 },
    orthodonticLifetimeMax: 2000,
    waitingPeriods: { preventive: 0, basic: 3, major: 6 },
    frequency: {
      cleaningMonths: 6,
      examMonths: 6,
      xrayBitewingMonths: 12,
      xrayFullSeriesMonths: 60,
      crownMonths: 60,
      sealantAgeLimit: 14,
    },
    notes: 'Lower deductible and annual max. Basic covers only 70%.',
  },

  green_shield: {
    carrierCode: 'green_shield',
    carrierName: 'Green Shield Canada',
    version: '2025',
    deductible: { single: 0, family: 0 },
    annualMax: { single: 1200, family: 3600 },
    coverage: { preventive: 100, basic: 80, major: 50, orthodontic: 50 },
    orthodonticLifetimeMax: 2500,
    waitingPeriods: { preventive: 0, basic: 0, major: 6 },
    frequency: {
      cleaningMonths: 6,
      examMonths: 6,
      xrayBitewingMonths: 12,
      xrayFullSeriesMonths: 60,
      crownMonths: 60,
      sealantAgeLimit: 17,
    },
    notes: 'No deductible — patient-friendly. No waiting on preventive/basic.',
  },

  rbc_insurance: {
    carrierCode: 'rbc_insurance',
    carrierName: 'RBC Insurance',
    version: '2025',
    deductible: { single: 50, family: 150 },
    annualMax: { single: 1200, family: 3600 },
    coverage: { preventive: 100, basic: 80, major: 50, orthodontic: 50 },
    orthodonticLifetimeMax: 2500,
    waitingPeriods: { preventive: 0, basic: 3, major: 6 },
    frequency: {
      cleaningMonths: 6,
      examMonths: 6,
      xrayBitewingMonths: 12,
      xrayFullSeriesMonths: 60,
      crownMonths: 60,
      sealantAgeLimit: 17,
    },
    notes: 'Standard RBC plan — mirrors Sun Life structure.',
  },

  telus_adjudicare: {
    carrierCode: 'telus_adjudicare',
    carrierName: 'TELUS Adjudicare',
    version: '2025',
    deductible: { single: 0, family: 0 },
    annualMax: { single: 1500, family: 4500 },
    coverage: { preventive: 100, basic: 90, major: 60, orthodontic: 60 },
    orthodonticLifetimeMax: 3000,
    waitingPeriods: { preventive: 0, basic: 0, major: 3 },
    frequency: {
      cleaningMonths: 6,
      examMonths: 6,
      xrayBitewingMonths: 12,
      xrayFullSeriesMonths: 60,
      crownMonths: 60,
      sealantAgeLimit: 17,
    },
    notes: 'Most generous plan. No deductible, higher coverage %, short waiting.',
  },
};

export const VALID_CARRIER_CODES = Object.keys(CARRIER_RULES);

export function getCarrierRule(carrierCode: string): CarrierRuleConfig | null {
  return CARRIER_RULES[carrierCode] ?? null;
}

/**
 * Map a CDT code to its coverage category for a given carrier.
 * Returns 'preventive' | 'basic' | 'major' | 'orthodontic' | 'not_covered'
 *
 * CDT codes are D followed by 4 digits. We look at the leading digit series:
 *  D0xxx → Diagnostic     → preventive
 *  D1xxx → Preventive     → preventive
 *  D2xxx → Restorative    → basic
 *  D3xxx → Endodontics    → basic
 *  D4xxx → Periodontics   → basic
 *  D5xxx → Prosthodontics → major
 *  D6xxx → Implants/Fixed → major
 *  D7xxx → Oral Surgery   → basic
 *  D8xxx → Orthodontics   → orthodontic
 *  D9xxx → Adjunctive     → basic
 */
export function getCdtCoverageCategory(cdtCode: string): 'preventive' | 'basic' | 'major' | 'orthodontic' | 'not_covered' {
  // CDT format: D followed by exactly 4 digits (with leading zeros, e.g. D0120)
  const match = cdtCode.match(/^D(\d{4})$/);
  if (!match) return 'not_covered';

  const seriesDigit = parseInt(match[1][0], 10); // first digit of the 4-digit number

  switch (seriesDigit) {
    case 0: return 'preventive';   // D0xxx — Diagnostic (exams, x-rays)
    case 1: return 'preventive';   // D1xxx — Preventive (cleanings, fluoride, sealants)
    case 2: return 'basic';        // D2xxx — Restorative (fillings, crowns)
    case 3: return 'basic';        // D3xxx — Endodontics (root canals)
    case 4: return 'basic';        // D4xxx — Periodontics (SRP, perio maintenance)
    case 5: return 'major';        // D5xxx — Prosthodontics removable (dentures)
    case 6: return 'major';        // D6xxx — Implants and fixed prosthodontics
    case 7: return 'basic';        // D7xxx — Oral Surgery (extractions)
    case 8: return 'orthodontic';  // D8xxx — Orthodontics
    case 9: return 'basic';        // D9xxx — Adjunctive (anesthesia, misc)
    default: return 'not_covered';
  }
}
