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
  escalationPhoneNumber: string;
  telusTpaMappings: Record<string, string>;
}

export interface QueueStats {
  queued: number;
  held: number;
  isPaused: boolean;
  isWithinCallWindow: boolean;
  activeCall: {
    id: string;
    claimRef: string;
    carrierId: CarrierId;
    activeAgent: string | null;
    startedAt: string;
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
