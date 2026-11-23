/**
 * Versioned agreements a new account must accept before a practice exists.
 *
 * The version string identifies the exact document text the user saw. Bump it
 * whenever the text changes; acceptance rows keep the old version, so the
 * record shows which text each user agreed to.
 *
 * Only the Terms of use has published text today. The privacy and data
 * agreement and the call-listening consent carry draft versions until the
 * owner approves final wording, so a record never claims acceptance of text
 * that was not shown.
 */
export const AGREEMENT_KINDS = [
  'terms_of_service',
  'privacy_data_agreement',
  'call_listening_consent',
] as const;

export type AgreementKind = (typeof AGREEMENT_KINDS)[number];

export interface AgreementDefinition {
  kind: AgreementKind;
  version: string;
  title: string;
  /** In-app path where the full text is shown. */
  path: string;
  /** Short statement beside the signup checkbox. */
  summary: string;
}

export const CURRENT_AGREEMENTS: readonly AgreementDefinition[] = [
  {
    kind: 'terms_of_service',
    version: '2026-04-25',
    title: 'Terms of use',
    path: '/legal/terms',
    summary: 'I agree to the Terms of use for my practice.',
  },
  {
    kind: 'privacy_data_agreement',
    version: 'draft-1',
    title: 'Privacy and data agreement',
    path: '/legal/privacy',
    summary: 'I agree to the Privacy and data agreement, including how patient information is handled for my practice.',
  },
  {
    kind: 'call_listening_consent',
    version: 'draft-1',
    title: 'Call-listening consent',
    path: '/legal/call-listening',
    summary: 'I consent to CollectRx listening to calls placed to insurers for my practice so it can log outcomes.',
  },
];

export interface AcceptedAgreement {
  kind: AgreementKind;
  version: string;
}

export type AgreementCheck =
  | { ok: true; accepted: AgreementDefinition[] }
  | { ok: false; missing: AgreementKind[]; stale: AgreementKind[] };

/**
 * A submission passes only when every current agreement is present at its
 * current version. Extra or duplicate entries are ignored, never trusted.
 */
export function checkAcceptedAgreements(submitted: readonly AcceptedAgreement[]): AgreementCheck {
  const byKind = new Map<AgreementKind, string>();
  for (const s of submitted) byKind.set(s.kind, s.version);

  const missing: AgreementKind[] = [];
  const stale: AgreementKind[] = [];
  for (const def of CURRENT_AGREEMENTS) {
    const version = byKind.get(def.kind);
    if (version === undefined) missing.push(def.kind);
    else if (version !== def.version) stale.push(def.kind);
  }
  if (missing.length > 0 || stale.length > 0) return { ok: false, missing, stale };
  return { ok: true, accepted: [...CURRENT_AGREEMENTS] };
}
