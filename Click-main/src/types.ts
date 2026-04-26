// ── Shared TypeScript interfaces for CollectRx ──────────────────────────────

export interface Practice {
  id: string
  name: string
  timezone: string
}

export interface DashboardStats {
  totalOpenAR: number
  aging: {
    '0-30': number
    '31-60': number
    '>60': number
  }
  stageCounts: Record<string, number>
  openBalanceCount: number
}

export interface Patient {
  id: string
  displayName: string
  emailFake: string
  phoneFake: string
  preferredChannel: string
}

export interface Balance {
  id: string
  amount: number
  status: string
  daysOutstanding: number
  currentStage: string
  createdAt: string
  dueDate: string
  patient: Patient
  states: BalanceState[]
  outreachEvents: OutreachEvent[]
  paymentEvents: PaymentEvent[]
}

export interface BalanceListItem {
  id: string
  amount: number
  status: string
  daysOutstanding: number
  currentStage: string
  createdAt: string
  patient: {
    displayName: string
  }
}

export interface BalanceState {
  id: string
  stage: string
  stageAt: string
}

export interface OutreachEvent {
  id: string
  templateKey: string
  channel: string
  sentAt: string
  messageBody: string
  deliveryStatus: string
  responseStatus: string
  balance: {
    patient: { displayName: string }
    status: string
  }
}

export interface PaymentEvent {
  id: string
  amountCents: number
  method: string
  result: string
  paidAt: string
}

export interface CollectionRate {
  collectionRate: number
  paidCount: number
  totalCount: number
  avgDaysToPayment: number
  totalCollected: number
  totalOutstanding: number
  openCount: number
}

export interface FunnelStage {
  stage: string
  count: number
  dropOff: number
  dropOffRate: number
}

export interface PriorityBalance {
  id: string
  amount: number
  daysOutstanding: number
  currentStage: string
  priorityScore: number
  patient: { displayName: string }
}

export interface MessageEffectivenessItem {
  messageType: string
  totalSent: number
  responded: number
  paid: number
  responseRate: number
  paymentRate: number
}

export interface PaymentTrend {
  week: string
  paymentsCount: number
  avgDaysToPayment: number
  totalAmount: number
}

export interface PatientBalance {
  id: string
  patientFirstName: string
  patientLastName: string
  procedureCode?: string
  procedureDescription?: string
  treatmentDate?: string
  amountBilled?: number
  insurancePaid?: number
  patientOwes: number
  daysSinceAdjudication?: number
  reminderStatus: string
  paymentStatus: string
  stripePaymentLink?: string
}

export interface Benefits {
  annual_max?: number
  annual_max_used?: number
  pending_claims?: number
  plan_year_end?: string
  stale_flag?: boolean
  deductible?: number
  deductible_met?: number
}

export interface CoverageItem {
  cdt_category: string
  coverage_pct?: number
  waiting_period_months?: number
  waiting_period_start?: string
  frequency_limit_months?: number
  last_service_date?: string
}

export interface EstimateProcedure {
  code: string
  category: string
  fee: number
  coveragePct: number
  insurancePays: number
  patientOwes: number
}

export interface Estimate {
  totalFees?: number
  insurancePays?: number
  patientOwes?: number
  procedures?: EstimateProcedure[]
  deductibleApplied?: number
  exceedsAnnualMax?: boolean
  overageAmount?: number
}

// ── Phase 3: New Estimate Types ───────────────────────────────────────────────

export interface CdtCodeResult {
  code: string
  description: string
  category: string
  subcategory?: string
  typicalFee: number
}

export interface Phase3EstimateResult {
  cdtCode: string
  cdtDescription: string
  cdtCategory: string
  carrierCode: string
  carrierName: string
  procedureFee: number
  coverageCategory: string
  coveragePct: number
  deductibleApplied: number
  deductibleRemaining: number
  grossInsurancePays: number
  annualMaxCap: number
  insurancePays: number
  patientPays: number
  annualMaxRemaining: number
  frequencyLimited: boolean
  frequencyNote?: string
  waitingPeriodActive: boolean
  waitingPeriodNote?: string
  notCovered: boolean
  notCoveredReason?: string
  breakdown: string[]
}

export interface Phase3MultiEstimateResult {
  procedures: Phase3EstimateResult[]
  totalFee: number
  totalInsurancePays: number
  totalPatientPays: number
  finalAnnualMaxRemaining: number
  finalDeductibleRemaining: number
}

export const CARRIERS: Array<{ code: string; name: string }> = [
  { code: 'sun_life',         name: 'Sun Life Financial' },
  { code: 'manulife',         name: 'Manulife Financial' },
  { code: 'canada_life',      name: 'Canada Life' },
  { code: 'green_shield',     name: 'Green Shield Canada' },
  { code: 'rbc_insurance',    name: 'RBC Insurance' },
  { code: 'telus_adjudicare', name: 'TELUS Adjudicare' },
]
