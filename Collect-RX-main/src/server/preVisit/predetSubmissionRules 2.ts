/**
 * CDCP predetermination pre-submission validation — flags missing documentation
 * before a VAPI call is wasted on a submission that will be denied.
 */
import type { CarrierId } from '@prisma/client';
import { normalizeCdtCode, reconsiderationExclusionReason } from '../canadianExpansion/constants.js';
import { isCdcpCarrier, requiresCdcpPredetermination } from './procedureRules.js';

export type PredetArtifact =
  | 'periapical_xray'
  | 'bitewing_xray'
  | 'clinical_narrative'
  | 'treatment_plan'
  | 'periodontal_charting';

export interface PredetSubmissionInput {
  carrierId: CarrierId;
  procedureCodes: string[];
  /** Clinic attests these artifacts are attached in the PMS chart. */
  artifactAttestations?: Partial<Record<PredetArtifact, boolean>>;
}

export interface PredetSubmissionResult {
  passed: boolean;
  missingArtifacts: PredetArtifact[];
  excludedCodes: string[];
  qualifyingCodes: string[];
}

const ARTIFACT_RULES: Array<{
  prefix: RegExp;
  required: PredetArtifact[];
}> = [
  { prefix: /^D27/, required: ['periapical_xray', 'clinical_narrative'] },
  { prefix: /^D60/, required: ['periapical_xray', 'clinical_narrative', 'treatment_plan'] },
  { prefix: /^D72/, required: ['periapical_xray', 'clinical_narrative'] },
  { prefix: /^D51|^D52|^D53|^D54|^D55|^D56|^D57|^D58/, required: ['clinical_narrative', 'treatment_plan'] },
];

function requiredArtifactsForCode(cdtCode: string): PredetArtifact[] {
  const n = normalizeCdtCode(cdtCode);
  const digits = n.replace(/^D/, '');
  for (const rule of ARTIFACT_RULES) {
    if (rule.prefix.test(n) || rule.prefix.test(`D${digits}`)) {
      return rule.required;
    }
  }
  return ['clinical_narrative'];
}

export function validatePredetSubmission(input: PredetSubmissionInput): PredetSubmissionResult {
  if (!isCdcpCarrier(input.carrierId)) {
    return { passed: true, missingArtifacts: [], excludedCodes: [], qualifyingCodes: [] };
  }

  const qualifyingCodes = input.procedureCodes.filter(requiresCdcpPredetermination);
  const excludedCodes = qualifyingCodes.filter((c) => reconsiderationExclusionReason(c));
  const activeCodes = qualifyingCodes.filter((c) => !reconsiderationExclusionReason(c));

  if (activeCodes.length === 0) {
    return { passed: true, missingArtifacts: [], excludedCodes, qualifyingCodes };
  }

  const attest = input.artifactAttestations ?? {};
  const required = new Set<PredetArtifact>();
  for (const code of activeCodes) {
    for (const a of requiredArtifactsForCode(code)) {
      required.add(a);
    }
  }

  const missingArtifacts = [...required].filter((a) => attest[a] !== true);

  return {
    passed: missingArtifacts.length === 0,
    missingArtifacts,
    excludedCodes,
    qualifyingCodes: activeCodes,
  };
}
