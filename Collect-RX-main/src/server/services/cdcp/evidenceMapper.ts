/**
 * Phase 5: CDCP Clinical Evidence Mapper
 *
 * Maps CDCP denial reason codes to the specific clinical evidence required
 * for a successful Level 1 Reconsideration.
 *
 * Procedure sections sourced from CDCP Dental Benefits Guide:
 *  6.3.5.2 — Crowns
 *  6.4.2   — Root Canal Therapy (Endodontics)
 *  6.5.1   — Scaling / Root Planing (Periodontics)
 *
 * Usage:
 *   const gap = analyzeEvidenceGap(claim, availableEvidence);
 *   if (!gap.canProceedWithReconsideration) { // collect missing items }
 */

import type {
  CdcpDenialReasonCode,
  EvidenceChecklistItem,
  EvidenceGapAnalysis,
} from './types.js';

// ─── CDT Series → CDCP Procedure Section ─────────────────────────────────────

const CDT_TO_SECTION: Record<string, string> = {
  // Crowns (D2710–D2999)
  D2710: '6.3.5.2', D2712: '6.3.5.2', D2720: '6.3.5.2', D2721: '6.3.5.2',
  D2722: '6.3.5.2', D2740: '6.3.5.2', D2750: '6.3.5.2', D2751: '6.3.5.2',
  D2752: '6.3.5.2', D2780: '6.3.5.2', D2781: '6.3.5.2', D2782: '6.3.5.2',
  D2783: '6.3.5.2', D2790: '6.3.5.2', D2791: '6.3.5.2', D2792: '6.3.5.2',
  D2794: '6.3.5.2',
  // Root canals (D3310–D3330)
  D3310: '6.4.2', D3320: '6.4.2', D3330: '6.4.2', D3331: '6.4.2',
  D3332: '6.4.2', D3333: '6.4.2',
  // Scaling / Root Planing (D4341–D4342)
  D4341: '6.5.1', D4342: '6.5.1',
};

function getProcedureSection(cdtCode: string): string | null {
  return CDT_TO_SECTION[cdtCode] ?? null;
}

// ─── Evidence Requirements by Section ────────────────────────────────────────

function crownEvidenceChecklist(available: Set<string>): EvidenceChecklistItem[] {
  return [
    {
      evidenceType: 'perio_chart_6_site',
      description: 'Complete 6-site periodontal charting (probing depths, recession, BOP)',
      required: true,
      present: available.has('perio_chart_6_site'),
      notes: 'CDCP §6.3.5.2: Required to confirm restorative need vs. extraction.',
    },
    {
      evidenceType: 'bone_level_xray',
      description: 'Periapical radiograph demonstrating bone level ≥1:1.5 crown-to-root ratio',
      required: true,
      present: available.has('bone_level_xray'),
      notes: 'Ratio must be documented. Bone levels must be visible and measurable.',
    },
    {
      evidenceType: 'ferrule_measurement',
      description: 'Clinical confirmation of ≥1.5mm ferrule effect',
      required: true,
      present: available.has('ferrule_measurement'),
      notes: 'CDCP §6.3.5.2: Sub-gingival margin extension must be documented.',
    },
    {
      evidenceType: 'pre_op_xray',
      description: 'Pre-operative periapical radiograph (dated within 12 months)',
      required: true,
      present: available.has('pre_op_xray'),
      notes: 'Must be dated. Bitewing not sufficient — periapical required.',
    },
    {
      evidenceType: 'clinical_notes',
      description: 'Clinical notes documenting fracture, decay extent, or structural failure',
      required: true,
      present: available.has('clinical_notes'),
      notes: 'Specific tooth diagnosis, planned procedure, and clinical rationale.',
    },
  ];
}

function rootCanalEvidenceChecklist(available: Set<string>): EvidenceChecklistItem[] {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  return [
    {
      evidenceType: 'periapical_xray_recent',
      description: `Dated periapical radiograph taken within the last 12 months (after ${twelveMonthsAgo.toLocaleDateString('en-CA')})`,
      required: true,
      present: available.has('periapical_xray_recent'),
      notes: 'CDCP §6.4.2: The date on the radiograph is validated. Undated films are rejected.',
    },
    {
      evidenceType: 'pulp_vitality_test',
      description: 'Pulp vitality test results (thermal, EPT, or percussion)',
      required: true,
      present: available.has('pulp_vitality_test'),
      notes: 'Documents non-vital or symptomatic irreversible pulpitis diagnosis.',
    },
    {
      evidenceType: 'clinical_notes',
      description: 'Clinical notes with diagnosis code and symptom history',
      required: true,
      present: available.has('clinical_notes'),
      notes: 'Must include: presenting complaint, diagnosis, and treatment rationale.',
    },
    {
      evidenceType: 'periapical_pathology',
      description: 'Documentation of periapical pathology (if present)',
      required: false,
      present: available.has('periapical_pathology'),
      notes: 'Strengthens case for non-surgical root canal vs. extraction.',
    },
  ];
}

function scalingEvidenceChecklist(
  available: Set<string>,
  unitsRequested: number
): EvidenceChecklistItem[] {
  const CDCP_SCALING_UNIT_LIMIT = 4;
  const exceedsFrequency = unitsRequested > CDCP_SCALING_UNIT_LIMIT;

  const items: EvidenceChecklistItem[] = [
    {
      evidenceType: 'psr_score',
      description: 'Periodontal Screening and Recording (PSR) score (sextant-by-sextant)',
      required: true,
      present: available.has('psr_score'),
      notes: 'CDCP §6.5.1: PSR score is the primary triage tool. Must be provided for all 6 sextants.',
    },
    {
      evidenceType: 'perio_chart_6_site',
      description: 'Full 6-site periodontal chart with pocket depths, attachment loss, and BOP',
      required: true,
      present: available.has('perio_chart_6_site'),
      notes: 'Required for any scaling claim. Dates must be current (within 6 months).',
    },
    {
      evidenceType: 'clinical_notes',
      description: 'Clinical notes documenting periodontal diagnosis and treatment plan',
      required: true,
      present: available.has('clinical_notes'),
    },
  ];

  if (exceedsFrequency) {
    items.push({
      evidenceType: 'medical_rationale_additional_units',
      description: `Medical rationale for >4 units of scaling (requested: ${unitsRequested} units). CDCP permits max 4 units without additional justification.`,
      required: true,
      present: available.has('medical_rationale_additional_units'),
      notes: 'CDCP §6.5.1: Exceeding the 4-unit limit requires documented systemic risk factors (e.g., diabetes, cardiovascular disease) or documented severe generalized periodontitis (Stage III/IV).',
    });
  }

  return items;
}

// ─── General F-010 (Missing Documentation) Checklist ────────────────────────

function generalDocumentationChecklist(available: Set<string>): EvidenceChecklistItem[] {
  return [
    {
      evidenceType: 'clinical_notes',
      description: 'Clinical notes with diagnosis and treatment rationale',
      required: true,
      present: available.has('clinical_notes'),
    },
    {
      evidenceType: 'pre_op_xray',
      description: 'Pre-operative radiograph (periapical or panoramic as applicable)',
      required: true,
      present: available.has('pre_op_xray'),
    },
  ];
}

// ─── Main Gap Analysis ────────────────────────────────────────────────────────

export interface EvidenceAnalysisInput {
  claimId: string;
  cdtCode: string;
  denialReasonCode: CdcpDenialReasonCode;
  availableEvidenceTypes: string[];   // what the practice already has
  scalingUnitsRequested?: number;     // only for D4341/D4342
}

export function analyzeEvidenceGap(input: EvidenceAnalysisInput): EvidenceGapAnalysis {
  const available = new Set(input.availableEvidenceTypes);
  const section = getProcedureSection(input.cdtCode);
  const procedureSection = section ?? 'general';

  let checklist: EvidenceChecklistItem[];

  if (procedureSection === '6.3.5.2') {
    checklist = crownEvidenceChecklist(available);
  } else if (procedureSection === '6.4.2') {
    checklist = rootCanalEvidenceChecklist(available);
  } else if (procedureSection === '6.5.1') {
    checklist = scalingEvidenceChecklist(available, input.scalingUnitsRequested ?? 1);
  } else {
    checklist = generalDocumentationChecklist(available);
  }

  const missingEvidence = checklist.filter(item => item.required && !item.present);
  const blockingIssues: string[] = [];

  if (missingEvidence.length > 0) {
    blockingIssues.push(
      ...missingEvidence.map(item => `Missing: ${item.description}`)
    );
  }

  // Special case: F-011 (frequency limit) for scaling — always requires medical rationale
  if (input.denialReasonCode === 'F-011' && procedureSection === '6.5.1') {
    if (!available.has('medical_rationale_additional_units')) {
      blockingIssues.push(
        'F-011 frequency denial for scaling requires documented medical rationale. Collect systemic risk factor documentation.'
      );
    }
  }

  return {
    claimId: input.claimId,
    cdtCode: input.cdtCode,
    denialReasonCode: input.denialReasonCode,
    procedureSection,
    requiredEvidence: checklist.filter(i => i.required),
    missingEvidence,
    canProceedWithReconsideration: blockingIssues.length === 0,
    blockingIssues,
  };
}

// ─── Batch Gap Analysis ───────────────────────────────────────────────────────

export function analyzeEvidenceBatch(
  inputs: EvidenceAnalysisInput[]
): EvidenceGapAnalysis[] {
  return inputs.map(analyzeEvidenceGap);
}

// ─── Human-readable evidence summary ─────────────────────────────────────────

export function formatEvidenceSummary(gap: EvidenceGapAnalysis): string {
  if (gap.canProceedWithReconsideration) {
    return `✅ Claim ${gap.claimId}: All required evidence present. Ready to submit reconsideration.`;
  }

  const lines = [
    `⚠️  Claim ${gap.claimId} (${gap.cdtCode}, §${gap.procedureSection}): ${gap.missingEvidence.length} item(s) missing.`,
    '',
    'Required before submission:',
    ...gap.blockingIssues.map(issue => `  • ${issue}`),
  ];

  return lines.join('\n');
}
