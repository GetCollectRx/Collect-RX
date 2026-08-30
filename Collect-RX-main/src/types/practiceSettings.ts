import type { CarrierId } from '@prisma/client';
import type { PmsIngestMode, PmsVendorId } from './pms.js';

export interface CarrierConfig {
  carrierId: CarrierId;
  enabled: boolean;
  minimumClaimAgeDays: number;
  maxAttempts: number;
  callWindowStart: string;
  callWindowEnd: string;
  notes: string;
  /** Practice's provider/billing ID with this carrier — not PHI. */
  providerNumber: string;
  /** True once the billing agent authorization letter has been submitted to this carrier. */
  authorizationSubmitted: boolean;
  /** ISO timestamp of submission, or null if not yet submitted. */
  authorizationSubmittedAt: string | null;
  /**
   * Confirmation/reference number issued by the carrier when they accepted the BAAL.
   * Some carriers provide this verbally or by fax — record it here for reference during
   * calls if the carrier questions the authorization.
   */
  authorizationConfirmationNumber?: string;
  /**
   * Language to use when navigating this carrier's IVR and speaking with reps.
   * Defaults to 'en'. Set to 'fr' for Quebec carriers (Beneva, Canada Life QC, etc.).
   */
  languagePreference?: 'en' | 'fr';
}

export interface PracticeSettings {
  /** Canonical PMS vendor — drives import mapping only; phone logic is PMS-agnostic. */
  pmsVendor?: PmsVendorId;
  /** How claim/balance data reaches CollectRx for this practice. */
  pmsIngestMode?: PmsIngestMode;
  emailsEnabled: boolean;
  automationEnabled: boolean;
  sendFromPracticeEmail: boolean;
  voiceAgentEnabled: boolean;
  /** Owner-only toggles: grant plan/usage visibility to office manager. */
  usageVisibleToOfficeManager: boolean;
  /** Owner-only toggles: grant plan/usage visibility to billing coordinator. */
  usageVisibleToBillingCoordinator: boolean;
  /** Email owners (and opted-in roles) at 80% / 95% / 100% usage thresholds. */
  usageAlertEmailsEnabled: boolean;
  /** Internal — dedupe usage alert emails per billing cycle. */
  planUsageAlertCycleKey?: string;
  planUsageAlertsSent?: Record<string, boolean>;
  carrierConfigs: CarrierConfig[];
  callWindowStart: string;
  callWindowEnd: string;
  /**
   * Staff escalation line — where the AI transfers when staff takeover is needed.
   * NOT used for carrier callbacks or CRTC disclosure. See billingPhone for that.
   */
  escalationPhoneNumber: string;
  /**
   * Billing/claims contact number read aloud in the CRTC disclosure at call start
   * ("you can reach us at...") and given to carriers as a callback number.
   * Distinct from escalationPhoneNumber (staff takeover).
   * Falls back to escalationPhoneNumber if not set (backward-compatible).
   */
  billingPhone?: string;
  telusTpaMappings: Record<string, string>;
  /**
   * V1 human-assisted mode: practice staff make the call and speak with the
   * rep directly (IVR_Navigator -> Hold_Sentinel -> Claims_Scribe squad).
   * CollectRx's AI only navigates the IVR, holds the line, and silently
   * listens/logs — it never speaks to a carrier rep. Distinct from the
   * fully-autonomous squad and its CarrierLesson learning pipeline.
   */
  humanAssistedMode?: boolean;
}

export interface QueueStats {
  queued: number;
  held: number;
  isPaused: boolean;
  isWithinCallWindow: boolean;
  activeCall: {
    id: string;
    claimId: string;
    claimRef: string;
    carrierId: CarrierId;
    activeAgent: string | null;
    startedAt: string;
    vapiCallId?: string | null;
  } | null;
  resolvedToday: number;
}

export interface AgingBucket {
  label: 'Current' | '31–60' | '61–90' | '90+';
  totalAmount: number;
  claimCount: number;
  percentOfTotal: number;
}

export interface CarrierAgingRow {
  carrierId: CarrierId;
  carrierName: string;
  current: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  total: number;
}

export interface CarrierStatRow {
  carrierId: CarrierId;
  carrierName: string;
  totalClaims: number;
  successRate: number;
  avgCallDurationSeconds: number;
  avgAttempts: number;
  topDenialReason: string | null;
  trend: 'improving' | 'declining' | 'stable';
}

export interface DenialAnalyticsSnapshot {
  byCarrier: Array<{
    carrierId: CarrierId;
    totalClaims: number;
    deniedClaims: number;
    denialRate: number;
  }>;
  topDenialReasons: Array<{ reason: string; count: number }>;
  appealWinRate: number;
  avgDaysToResolution: number;
}

export type EscalationResolution =
  | 'resolved'
  | 'appealing'
  | 'written_off'
  | 'paused_for_review';

export interface EscalationDto {
  id: string;
  practiceId: string;
  callId: string | null;
  claimId: string;
  claimRef: string;
  carrierId: CarrierId;
  amountClaimedCents: number;
  reason: string;
  status: 'open' | 'resolved';
  resolution: EscalationResolution | null;
  resolvedByStaffId: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  attemptNumber: number | null;
  createdAt: string;
}
