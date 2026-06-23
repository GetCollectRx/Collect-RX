// ─────────────────────────────────────────────────────────────────────────────
// CollectRx Compliance Audit — Shared Types
//
// Regulations covered:
//   PHIPA  — Personal Health Information Protection Act (Ontario)
//   PIPEDA — Personal Information Protection and Electronic Documents Act
//   Law 25 — Loi 25 / Quebec Act respecting the protection of personal information
//   HIA    — Health Information Act (Alberta)
//   AIDA   — Artificial Intelligence and Data Act (voluntary regime)
// ─────────────────────────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';

export type ComplianceDomain =
  | 'PHI_BOUNDARY'
  | 'ENCRYPTION'
  | 'ACCESS_CONTROL'
  | 'AUDIT_TRAIL'
  | 'RATE_LIMITING'
  | 'DATA_RESIDENCY'
  | 'RETENTION'
  | 'DISCLOSURE'
  | 'INPUT_VALIDATION'
  | 'SESSION_SECURITY';

export type Regulation =
  | 'PHIPA'
  | 'PIPEDA'
  | 'Quebec-Law-25'
  | 'Alberta-HIA'
  | 'AIDA'
  | 'OWASP';

export interface ComplianceCheck {
  id: string;
  domain: ComplianceDomain;
  regulations: Regulation[];
  title: string;
  description: string;
  status: CheckStatus;
  evidence: string;
  recommendation?: string;
  /** PHIPA section / PIPEDA principle / other reference */
  reference?: string;
}

export interface ComplianceReport {
  generatedAt: string;
  version: string;
  environment: string;
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    info: number;
    /** 0–100 overall posture score (pass+warn×0.5) / total × 100 */
    score: number;
  };
  domains: {
    [K in ComplianceDomain]?: {
      checks: ComplianceCheck[];
      status: CheckStatus;
    };
  };
  criticalFindings: ComplianceCheck[];
  checks: ComplianceCheck[];
}
