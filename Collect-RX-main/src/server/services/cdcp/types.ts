/**
 * Phase 5: CDCP Reconsideration & High-Precision Adjudication — Shared Types
 *
 * Covers the CDCP Level 1 Reconsideration workflow defined in
 * Appendix C of the CDCP Dental Benefits Guide.
 */

// ─── Denial & Reconsideration ─────────────────────────────────────────────────

export type CdcpDenialReasonCode =
  | 'F-010'   // Missing/insufficient clinical documentation
  | 'F-011'   // Frequency limit exceeded
  | 'F-012'   // Waiting period not met
  | 'F-013'   // Tooth not eligible (missing-tooth clause)
  | 'F-014'   // Pre-authorization not obtained
  | 'F-015'   // Procedure not covered under CDCP
  | 'F-016'   // Alternative benefit applies
  | 'F-017'   // Patient income threshold not met
  | 'F-018'   // Duplicate claim
  | 'F-019'   // Invalid CDT/CDA procedure code
  | 'F-020';  // Provider not participating in CDCP

export type ReconsiderationStatus =
  | 'eligible'       // Within 60-day window, ready to file
  | 'urgent'         // ≥45 days — auto-escalated
  | 'expired'        // Past 60-day deadline
  | 'submitted'      // Reconsideration package sent
  | 'under_review'   // Sun Life adjudicator assigned
  | 'approved'       // Reconsideration approved — claim paid
  | 'denied_final';  // Second denial — no further recourse

export type EvidenceSubmissionMethod = 'cdanet_09' | 'paper_fallback';

export interface CdcpDeniedClaim {
  claimId: string;
  patientToken: string;          // UUID — PHI never stored here
  practiceId: string;
  cdtCode: string;
  cdaCode?: string;              // Canadian CDA procedure code
  denialReasonCode: CdcpDenialReasonCode;
  denialDate: Date;
  originalAdjudicatorId?: string;
  procedureFee: number;
  province: 'AB' | 'BC' | 'ON' | 'QC' | 'MB' | 'SK' | 'NS' | 'NB' | 'NL' | 'PE' | 'NT' | 'NU' | 'YT';
  transactionType: 'T11';       // CDCP pre-authorization transaction
}

export interface ReconsiderationRecord {
  id: string;
  claimId: string;
  patientToken: string;
  practiceId: string;
  denialReasonCode: CdcpDenialReasonCode;
  denialDate: Date;
  deadlineDate: Date;            // denialDate + 60 days
  urgentEscalationDate: Date;   // denialDate + 45 days
  status: ReconsiderationStatus;
  evidenceChecklist: EvidenceChecklistItem[];
  submissionMethod?: EvidenceSubmissionMethod;
  submittedAt?: Date;
  originalAdjudicatorId?: string;
  assignedAdjudicatorId?: string;  // must differ from original
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Evidence ─────────────────────────────────────────────────────────────────

export interface EvidenceChecklistItem {
  evidenceType: string;
  description: string;
  required: boolean;
  present: boolean;
  notes?: string;
}

export interface EvidenceGapAnalysis {
  claimId: string;
  cdtCode: string;
  denialReasonCode: CdcpDenialReasonCode;
  procedureSection: string;     // e.g. '6.3.5.2', '6.4.2', '6.5.1'
  requiredEvidence: EvidenceChecklistItem[];
  missingEvidence: EvidenceChecklistItem[];
  canProceedWithReconsideration: boolean;
  blockingIssues: string[];
}

// ─── CDAnet Transaction 09 ────────────────────────────────────────────────────

export interface CdanetAttachment {
  transactionType: '09';
  claimId: string;
  practiceId: string;
  attachments: AttachmentFile[];
  totalSizeBytes: number;
  encryptionKeyId?: string;
  submittedAt?: Date;
  confirmationNumber?: string;
}

export interface AttachmentFile {
  type: 'xray' | 'psr_score' | 'clinical_note' | 'perio_chart' | 'referral';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  base64Data?: string;
  description: string;
}

export interface PaperReconsiderationPackage {
  claimId: string;
  patientToken: string;
  practiceId: string;
  mailingAddress: {
    recipient: string;
    poBox: string;
    city: string;
    province: string;
    postalCode: string;
  };
  coverLetterText: string;
  checklistItems: string[];
  generatedAt: Date;
  pdfPath?: string;
}

// ─── 2026 Fee Guides ──────────────────────────────────────────────────────────

export interface ProvinceFeeFGuide {
  province: string;
  year: number;
  incrementPct: number;         // e.g. 4.5 for Alberta
  cdcpReimbursementPct: number; // typically 88–95% of provincial guide
  cdcpFeeGridUrl?: string;
  effectiveDate: Date;
}

// ─── KPI Metrics ──────────────────────────────────────────────────────────────

export interface Phase5KpiSnapshot {
  snapshotDate: Date;
  practiceId: string;

  // Dim 1
  reconsiderationSuccessRate: number;      // % of denied → paid
  // Dim 2
  ivrNavigationSuccessRate: number;        // % of calls reaching CDCP contact centre
  // Dim 3
  authenticationSuccessRate: number;       // % of third-party attestations accepted
  // Dim 4
  statusRetrievalAccuracy: number;         // % correct status reads
  // Dim 5
  denialTaxonomyMappingAccuracy: number;   // % denial codes correctly mapped
  // Dim 6
  zeroHallucinationRate: number;           // % of calls with no hallucinated data
  // Dim 7
  disclosureComplianceRate: number;        // % of calls with required disclosures
  // Dim 8
  medianCallDurationSeconds: number;       // target < 720 s (12 min)
}
