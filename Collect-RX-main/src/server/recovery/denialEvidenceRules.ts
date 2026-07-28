/**
 * Generalized denial-code → evidence checklist (v1 attestations only).
 * Clinical files remain in the PMS; staff attest that required items exist.
 */

export type DenialCategory =
  | 'plan_exclusion'
  | 'missing_documentation'
  | 'frequency_limit'
  | 'coordination_of_benefits'
  | 'manual_review_pending'
  | 'annual_maximum_reached'
  | 'deductible_not_met'
  | 'provider_not_eligible'
  | 'claim_already_paid'
  | 'other';

export interface DenialEvidenceRequirement {
  evidenceType: string;
  description: string;
}

const GENERIC_DENIAL_EVIDENCE: DenialEvidenceRequirement[] = [
  { evidenceType: 'clinical_notes', description: 'Clinical notes supporting the billed procedure' },
  { evidenceType: 'pre_op_xray', description: 'Diagnostic radiograph dated within carrier window' },
  { evidenceType: 'carrier_eob', description: 'Carrier EOB or remittance showing denial detail' },
];

const CODE_PREFIX_RULES: Array<{ prefix: string; items: DenialEvidenceRequirement[] }> = [
  {
    prefix: 'FREQ',
    items: [
      { evidenceType: 'treatment_history', description: 'Prior treatment dates for frequency-limited code' },
      { evidenceType: 'clinical_notes', description: 'Clinical rationale if exception applies' },
    ],
  },
  {
    prefix: 'COB',
    items: [
      { evidenceType: 'primary_eob', description: 'Primary carrier EOB for coordination of benefits' },
      { evidenceType: 'cob_form', description: 'Completed COB / dual-coverage attestation' },
    ],
  },
  {
    prefix: 'DOC',
    items: [
      { evidenceType: 'clinical_notes', description: 'Procedure narrative matching billed codes' },
      { evidenceType: 'supporting_imaging', description: 'Radiographs or photos referenced on claim' },
    ],
  },
];

const CARRIER_DOC_PATTERNS: Record<string, DenialEvidenceRequirement[]> = {
  sun_life: [{ evidenceType: 'sunlife_reference', description: 'Sun Life claim or reference number from denial' }],
  canada_life: [{ evidenceType: 'canada_life_portal_screenshot', description: 'ProviderConnect denial detail (metadata only)' }],
  telus_adjudicare: [{ evidenceType: 'telus_paper_eob', description: 'Paper EOB when past electronic inquiry window' }],
};

export function evidenceRequirementsForDenial(params: {
  denialReasonCode?: string | null;
  carrierId?: string | null;
  treatmentCodes?: string | null;
}): DenialEvidenceRequirement[] {
  const code = (params.denialReasonCode ?? '').trim().toUpperCase();
  const carrierKey = (params.carrierId ?? '').trim().toLowerCase();
  const items: DenialEvidenceRequirement[] = [...GENERIC_DENIAL_EVIDENCE];

  for (const rule of CODE_PREFIX_RULES) {
    if (code.startsWith(rule.prefix)) {
      items.push(...rule.items);
    }
  }

  if (carrierKey && CARRIER_DOC_PATTERNS[carrierKey]) {
    items.push(...CARRIER_DOC_PATTERNS[carrierKey]);
  }

  if ((params.treatmentCodes ?? '').match(/D27|D29|D33|D4341/)) {
    items.push({
      evidenceType: 'restorative_rationale',
      description: 'Restorative/endodontic/periodontal clinical rationale per fee guide',
    });
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.evidenceType)) return false;
    seen.add(item.evidenceType);
    return true;
  });
}

export function categorizeDenial(params: {
  denialReasonCode?: string | null;
  denialReasonText?: string | null;
  outcomeDetail?: string | null;
}): DenialCategory {
  const code = (params.denialReasonCode ?? '').trim().toUpperCase();
  const text = ((params.denialReasonText ?? '') + (params.outcomeDetail ?? '')).toLowerCase();

  if (
    code.includes('FREQ') ||
    text.includes('frequency') ||
    text.includes('too soon') ||
    text.includes('within')
  ) {
    return 'frequency_limit';
  }

  if (code.includes('COB') || text.includes('coordination of benefits') || text.includes('other insurance')) {
    return 'coordination_of_benefits';
  }

  if (
    code.includes('DOC') ||
    text.includes('documentation') ||
    text.includes('missing') ||
    text.includes('supporting') ||
    text.includes('receipt')
  ) {
    return 'missing_documentation';
  }

  if (
    code.includes('EXCL') ||
    text.includes('exclusion') ||
    text.includes('not covered') ||
    text.includes('not eligible')
  ) {
    return 'plan_exclusion';
  }

  if (code.includes('MAX') || text.includes('annual maximum') || text.includes('lifetime maximum')) {
    return 'annual_maximum_reached';
  }

  if (code.includes('DED') || text.includes('deductible') || text.includes('plan deductible')) {
    return 'deductible_not_met';
  }

  if (code.includes('PROV') || text.includes('provider') || text.includes('not in network')) {
    return 'provider_not_eligible';
  }

  if (
    code.includes('PAID') ||
    text.includes('already paid') ||
    text.includes('duplicate') ||
    text.includes('previously paid')
  ) {
    return 'claim_already_paid';
  }

  if (
    code.includes('REVIEW') ||
    code.includes('MANUAL') ||
    text.includes('under review') ||
    text.includes('manual review')
  ) {
    return 'manual_review_pending';
  }

  return 'other';
}
