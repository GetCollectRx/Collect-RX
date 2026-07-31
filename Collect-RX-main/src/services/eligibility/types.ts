// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Phase 3 Eligibility Rules Engine
// types.ts — All shared TypeScript interfaces & enums
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum Carrier {
  SunLife = 'sun_life',
  CanadaLife = 'canada_life',
  Manulife = 'manulife',
  GreenShield = 'green_shield',
  RBC = 'rbc',
  TELUSAdjudiCare = 'telus_adjudicare',
}

export enum CoverageTier {
  Preventive = 'preventive',
  Basic = 'basic',
  Major = 'major',
  Ortho = 'ortho',
}

export enum EligibilityStatus {
  Active = 'active',
  Inactive = 'inactive',
  Unknown = 'unknown',
}

export enum COBRole {
  Primary = 'primary',
  Secondary = 'secondary',
}

export enum ReconciliationFlag {
  WithinThreshold = 'within_threshold',
  VarianceHigh = 'variance_high',      // >$50 difference
  VarianceCritical = 'variance_critical', // >$150 difference — escalate
  NeedsReview = 'needs_review',
}

// ---------------------------------------------------------------------------
// Carrier Config (lives in JSON, typed here)
// ---------------------------------------------------------------------------

export interface FrequencyLimit {
  cdtCodePattern: string; // e.g. "D1110", "D0210"
  limitPerMonths: number; // e.g. 6 = once per 6 months
  description: string;
}

export interface WaitingPeriod {
  tier: CoverageTier;
  months: number;
  description: string;
}

export interface CarrierConfig {
  carrierId: Carrier;
  name: string;
  coveragePercent: Record<CoverageTier, number>; // 0–100
  deductible: {
    individual: number;
    family: number;
    appliesToTiers: CoverageTier[]; // preventive often exempt
  };
  annualMax: {
    individual: number;
    family: number | null; // null = no family cap
  };
  waitingPeriods: WaitingPeriod[];
  frequencyLimits: FrequencyLimit[];
  notes: string;
  // TELUS AdjudiCare-specific
  isClearinghouse?: boolean;
  minWaitDayForClaims?: number; // day 21 for TELUS vs day 32 for Canada Life
}

// ---------------------------------------------------------------------------
// Patient & Plan
// ---------------------------------------------------------------------------

export interface InsurancePlan {
  planId: string;
  carrier: Carrier;
  planName: string;
  groupNumber: string;
  memberId: string;
  effectiveDate: string; // ISO date
  terminationDate: string | null;
  planType: 'group' | 'individual';
  // For TELUS: specific TPA behind the clearinghouse
  telusUnderlyingTpa?: string;
}

export interface Patient {
  patientId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO date YYYY-MM-DD
  primaryPlan: InsurancePlan;
  secondaryPlan?: InsurancePlan; // COB
  relationshipToSubscriber: 'self' | 'spouse' | 'child' | 'other';
  subscriberDateOfBirth?: string; // for birthday rule COB
}

// ---------------------------------------------------------------------------
// Eligibility Snapshot (cached from IVR/Abeldent)
// ---------------------------------------------------------------------------

export interface EligibilitySnapshot {
  snapshotId: string;
  /** PMS record ID. Null for rows written by the pre-visit pipeline, which only has a PIIVault token. */
  patientId: string | null;
  carrier: Carrier;
  status: EligibilityStatus;
  verifiedAt: string; // ISO datetime
  deductibleIndividualMet: number;
  deductibleFamilyMet: number;
  annualMaxUsedIndividual: number;
  annualMaxUsedFamily: number | null;
  planYearStart: string; // ISO date — resets tracking
  rawCarrierResponse?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Procedure Input
// ---------------------------------------------------------------------------

export interface ProcedureInput {
  cdtCode: string;         // e.g. "D2740"
  description?: string;
  providerFee: number;     // in dollars
  quantity: number;
  dateOfService: string;   // ISO date
  toothNumber?: string;
}

// ---------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------

export interface ProcedureEstimate {
  cdtCode: string;
  tier: CoverageTier;
  providerFee: number;
  coveragePercent: number;
  grossInsurancePortion: number;  // before deductible/cap
  deductibleApplied: number;      // amount of deductible charged to this procedure
  annualMaxCapApplied: number;    // amount trimmed due to annual max
  netInsurancePortion: number;    // after deductible + annual max
  patientPortion: number;
  waitingPeriodBlock: boolean;    // true if waiting period prevents coverage
  frequencyLimitBlock: boolean;   // true if frequency limit prevents coverage
  notes: string[];
}

export interface EligibilityEstimate {
  estimateId: string;
  patientId: string;
  carrier: Carrier;
  generatedAt: string;
  procedures: ProcedureEstimate[];
  totals: {
    providerFeeTotal: number;
    insuranceTotal: number;
    patientTotal: number;
    deductibleAppliedTotal: number;
  };
  cobEstimate?: COBEstimate;
  confidenceScore: number;  // 0–100
  confidenceNotes: string[];
  eligibilityStatus: EligibilityStatus;
  estimatedDeductibleRemaining: number;
  estimatedAnnualMaxRemaining: number;
}

// ---------------------------------------------------------------------------
// Coordination of Benefits
// ---------------------------------------------------------------------------

export interface COBEstimate {
  primaryCarrier: Carrier;
  secondaryCarrier: Carrier;
  primaryInsurancePays: number;
  secondaryInsurancePays: number;
  patientPaysAfterCOB: number;
  birthdayRuleApplied: boolean;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ActualAdjudication {
  claimId: string;
  patientId: string;
  carrier: Carrier;
  adjudicatedAt: string;
  procedures: Array<{
    cdtCode: string;
    providerFee: number;
    insurancePaid: number;
    patientPaid: number;
    denialReason?: string;
  }>;
  eobReceivedAt: string;
}

export interface ReconciliationResult {
  reconciliationId: string;
  claimId: string;
  patientId: string;
  estimateId: string;
  reconciledAt: string;
  estimatedPatientTotal: number;
  actualPatientTotal: number;
  variance: number;             // actual - estimated (positive = patient owes more)
  variancePercent: number;
  flag: ReconciliationFlag;
  patientBalanceAdjustment: number;  // positive = patient owes more, negative = credit
  varianceReasons: string[];
  requiresHumanReview: boolean;
}

// ---------------------------------------------------------------------------
// TELUS AdjudiCare TPA Identification
// ---------------------------------------------------------------------------

export interface TELUSTPAIdentification {
  memberId: string;
  groupNumber: string;
  identifiedTpa: string | null;
  identificationMethod: 'member_card_prefix' | 'group_number_range' | 'manual' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  minWaitDay: number; // 21 for TELUS
  notes: string;
}

// ---------------------------------------------------------------------------
// API Request/Response shapes
// ---------------------------------------------------------------------------

export interface EstimateRequest {
  patientId: string;
  procedures: ProcedureInput[];
  carrier: Carrier;
  eligibilitySnapshot?: EligibilitySnapshot;
  secondaryCarrier?: Carrier;
  secondaryEligibilitySnapshot?: EligibilitySnapshot;
}

export interface EstimateResponse {
  success: boolean;
  estimate?: EligibilityEstimate;
  error?: string;
}

export interface ReconcileRequest {
  estimateId: string;
  adjudication: ActualAdjudication;
}

export interface ReconcileResponse {
  success: boolean;
  result?: ReconciliationResult;
  error?: string;
}

export interface StatusRequest {
  patientId: string;
  carrier: Carrier;
}

export interface StatusResponse {
  success: boolean;
  snapshot?: EligibilitySnapshot;
  error?: string;
}
