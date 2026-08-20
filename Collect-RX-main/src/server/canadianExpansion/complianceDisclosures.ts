/**
 * MOD-02 — Law 25 / PIPEDA-aligned copy blocks & voluntary AI transparency (AIDA voluntary regime).
 * Also covers CRTC Automated Dialing-Announcing Device (ADAD) obligations under the
 * Telecommunications Act — required identification within 10 seconds of call answer.
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
          'Under the CRTC Unsolicited Telecommunications Rules (Telecommunications Act), automated calling systems must identify themselves as automated within the first 10 seconds of a call. The identification must include: (1) that the call is automated, (2) the name of the organization on whose behalf the call is made, and (3) a contact number where the organization can be reached.',
        requiredElements: [
          'Automated nature of the call — stated in the opening utterance.',
          'Organization name — the dental practice name on whose behalf the call is made.',
          'Contact number — the practice phone number, spoken in the opening disclosure.',
          'Recording notice — disclosure that the call may be recorded for quality purposes.',
        ],
        enforcementNote:
          'CollectRx satisfies the 10-second rule with a hardcoded, CRTC-compliant opening line configured as Claims_Agent.firstMessage in vapi-squad-config.json (spoken only after IVR navigation completes and a live representative answers — IVR_Navigator and Hold_Sentinel have empty firstMessage and never speak to a machine or hold queue). ADAD delivery is verified post-call via transcript analysis and logged to the audit trail (action: ADAD_DISCLOSURE_VERIFIED / ADAD_DISCLOSURE_UNVERIFIED).',
      },
      dnclExemption: {
        applies: true,
        rationale:
          'CollectRx calls are placed by dental practices (businesses) to insurance carrier claims departments (businesses). These are B2B calls and fall under the CRTC National Do Not Call List exemption for calls made to businesses under Telecom Decision 2007-48, section 9(b). No DNCL check is required for insurance carrier claims lines.',
        reference: 'CRTC Telecom Decision 2007-48 §9(b) — Business-to-business exemption.',
      },
      recordingDisclosure:
        'All outbound calls include a recording notice in the mandatory opening disclosure: "This call may be recorded for quality purposes." This satisfies CRTC requirements for recording notification.',
    },
    collectrxAssurances: [
      'Architecture targets PHIPA / PIPEDA-aligned handling for Canadian dental workflows.',
      'Carrier-specific configuration (including TELUS AdjudiCare TPA routing) lives in data files — auditable changes.',
    ],
  };
}
