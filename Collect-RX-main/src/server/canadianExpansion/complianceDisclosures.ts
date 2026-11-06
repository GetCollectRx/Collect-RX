/**
 * MOD-02 — Law 25 / PIPEDA-aligned copy blocks & voluntary AI transparency (AIDA voluntary regime).
 * Also describes the conservative identification controls CollectRx applies to
 * automated carrier calls while the CRTC considers AI/synthetic-voice treatment.
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
  crtcTelecommunications: {
    adad: {
      summary: string;
      requiredElements: string[];
      enforcementNote: string;
    };
    dnclExemption: {
      applies: boolean;
      rationale: string;
      reference: string;
    };
    recordingDisclosure: string;
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
    crtcTelecommunications: {
      adad: {
        summary:
          'CollectRx conservatively opens human-facing automated carrier interactions with clear automation, practice identity, purpose, and contact disclosures. The CRTC rules contain identification requirements for applicable ADAD calls; their ten-second provision governs disconnection after the called party hangs up and must not be presented as a universal disclosure deadline.',
        requiredElements: [
          'Automated nature of the call — stated in the opening utterance.',
          'Organization name — the dental practice name on whose behalf the call is made.',
          'Contact number — the practice phone number, spoken in the opening disclosure.',
          'Recording notice — disclosure that the call may be recorded for quality purposes.',
        ],
        enforcementNote:
          'The opening line is a product safety control, not a legal-compliance certification. Every completed human interaction must have positive evidence that the disclosure was delivered; missing evidence requires manual review and must not pass validation.',
      },
      dnclExemption: {
        applies: false,
        rationale:
          'Carrier claims lines are generally business destinations, but CollectRx does not encode a blanket legal exemption. Destination classification and the rules applicable to each calling workflow require documented operator review before production use.',
        reference: 'CRTC Telecom Decision 2007-48 §9(b) — Business-to-business exemption.',
      },
      recordingDisclosure:
        'The configured opening disclosure includes a recording/transcription notice. Delivery is validated as a product control; CollectRx does not characterize that fact alone as satisfying every applicable recording or consent requirement.',
    },
    collectrxAssurances: [
      'Architecture targets PHIPA / PIPEDA-aligned handling for Canadian dental workflows.',
      'Carrier-specific configuration (including TELUS AdjudiCare TPA routing) lives in data files — auditable changes.',
    ],
  };
}
