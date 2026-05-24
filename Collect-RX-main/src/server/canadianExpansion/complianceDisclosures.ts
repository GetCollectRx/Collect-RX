/**
 * MOD-02 — Law 25 / PIPEDA-aligned copy blocks & voluntary AI transparency (AIDA voluntary regime).
 * Not legal advice — product disclosures for carriers and Quebec scaling readiness.
 */

export type ComplianceBundle = {
  quebecLaw25: {
    summary: string;
    privacyByDesignBullets: string[];
    piaNote: string;
  };
  aiTransparency: {
    carrierDisclosureScript: string;
    voluntaryCodePillars: string[];
  };
  collectrxAssurances: string[];
};

export function getComplianceDisclosures(): ComplianceBundle {
  return {
    quebecLaw25: {
      summary:
        'Quebec Law 25 imposes strict accountability for personal information. Scaling services to Quebec practices requires a documented Privacy Impact Assessment (PIA) and highest-protection defaults.',
      privacyByDesignBullets: [
        'Collect only minimum necessary operational fields for AR follow-up.',
        'PHI stays tokenized before any external voice automation; detokenization remains server-side.',
        'Retention windows and deletion workflows documented per practice agreement.',
      ],
      piaNote:
        'Before live Quebec production traffic, complete a PIA covering CDCP data flows, carrier transcripts storage, and subprocessors.',
    },
    aiTransparency: {
      carrierDisclosureScript:
        'When interacting with dental benefit carriers: disclose that automated voice agents may assist with claim status on behalf of the dental practice, that calls may be recorded or transcribed for quality, and that human staff can take over if requested — aligned with voluntary transparency expectations while federal AIDA rules evolve.',
      voluntaryCodePillars: [
        'Safety — monitor emergent behaviour on automated calls; suspend carriers on CARRIER_BLOCK.',
        'Fairness — avoid demographic routing assumptions in queue prioritization.',
        'Transparency — this disclosure plus dashboard metrics on automation usage.',
        'Accountability — audit logs for admin actions and CSV imports.',
        'Human oversight — escalation paths for denials and patient disputes.',
        'Validity — provenance for carrier configs and estimate rules (JSON/versioned data).',
      ],
    },
    collectrxAssurances: [
      'Architecture targets PHIPA / PIPEDA-aligned handling for Canadian dental workflows.',
      'Carrier-specific configuration (including TELUS AdjudiCare TPA routing) lives in data files — auditable changes.',
    ],
  };
}
