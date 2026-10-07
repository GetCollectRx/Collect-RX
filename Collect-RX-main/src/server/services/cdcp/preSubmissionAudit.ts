/**
 * Pre-Submission Attachment Audit
 *
 * Runs the same per-procedure evidence checklists as evidenceMapper.ts's
 * post-denial reconsideration gap analysis, but *before* a predetermination
 * or claim is submitted — shifting the CDCP evidence requirements left from
 * "collect what's missing after a denial" to "block submission until it's
 * complete." No denial reason code exists at this point (nothing has been
 * adjudicated yet), so this calls the shared checklist builders directly by
 * CDT code rather than through analyzeEvidenceGap, which requires one.
 *
 * High-rejection procedures (crowns, root canals, scaling beyond CDCP's
 * 4-unit limit) are exactly the set evidenceMapper.ts already documents
 * evidence requirements for — reused here, not reimplemented, per
 * evidenceMapper.ts §"Evidence Requirements by Section".
 */

import {
  getProcedureSection,
  crownEvidenceChecklist,
  rootCanalEvidenceChecklist,
  scalingEvidenceChecklist,
  generalDocumentationChecklist,
} from './evidenceMapper.js';
import type { EvidenceChecklistItem } from './types.js';

export interface PreSubmissionAuditInput {
  claimId: string;
  cdtCode: string;
  availableEvidenceTypes: string[];
  /** Only meaningful for D4341/D4342 (scaling/root planing). */
  scalingUnitsRequested?: number;
}

export interface PreSubmissionAuditResult {
  claimId: string;
  cdtCode: string;
  /** CDCP Dental Benefits Guide section this procedure falls under, or 'general'. */
  procedureSection: string;
  requiredEvidence: EvidenceChecklistItem[];
  missingEvidence: EvidenceChecklistItem[];
  /** False blocks packaging into the Version 4 XML payload — see buildPredeterminationPayload. */
  readyToSubmit: boolean;
  blockingIssues: string[];
}

function checklistForProcedure(
  cdtCode: string,
  available: Set<string>,
  scalingUnitsRequested: number,
): { procedureSection: string; checklist: EvidenceChecklistItem[] } {
  const section = getProcedureSection(cdtCode);

  if (section === '6.3.5.2') {
    return { procedureSection: section, checklist: crownEvidenceChecklist(available) };
  }
  if (section === '6.4.2') {
    return { procedureSection: section, checklist: rootCanalEvidenceChecklist(available) };
  }
  if (section === '6.5.1') {
    return {
      procedureSection: section,
      checklist: scalingEvidenceChecklist(available, scalingUnitsRequested),
    };
  }
  return { procedureSection: 'general', checklist: generalDocumentationChecklist(available) };
}

/**
 * Audits a single procedure's clinical documentation before it is packaged
 * into a predetermination or claim submission. Returns readyToSubmit: false
 * with the specific missing items when required evidence (crown-root ratio
 * films, PSR scores, restorative justification, etc.) is absent — callers
 * must not call buildPredeterminationPayload until this passes.
 */
export function auditPreSubmissionEvidence(
  input: PreSubmissionAuditInput,
): PreSubmissionAuditResult {
  const available = new Set(input.availableEvidenceTypes);
  const { procedureSection, checklist } = checklistForProcedure(
    input.cdtCode,
    available,
    input.scalingUnitsRequested ?? 1,
  );

  const requiredEvidence = checklist.filter((item) => item.required);
  const missingEvidence = requiredEvidence.filter((item) => !item.present);
  const blockingIssues = missingEvidence.map((item) => `Missing: ${item.description}`);

  return {
    claimId: input.claimId,
    cdtCode: input.cdtCode,
    procedureSection,
    requiredEvidence,
    missingEvidence,
    readyToSubmit: blockingIssues.length === 0,
    blockingIssues,
  };
}

export function auditPreSubmissionBatch(
  inputs: PreSubmissionAuditInput[],
): PreSubmissionAuditResult[] {
  return inputs.map(auditPreSubmissionEvidence);
}
