/**
 * Canadian voice-agent prompt templates and bilingual IVR rules for the
 * multi-vertical expansion.
 *
 * Conventions kept from vapi-system-prompt.md:
 *  - {{double_brace}} variables are filled at dispatch time. Person-linked data
 *    (names, policy numbers, VINs, health card numbers) arrive only as ephemeral
 *    call variables and are never written into these templates (see
 *    docs/compliance/PHI-VAPI-BOUNDARY.md).
 *  - The canonical disclosure (docs/compliance/crtc-disclosure-decision.md) is
 *    mandatory at the start of every live-representative interaction and is
 *    never spoken to an IVR machine.
 *  - Scope is claim STATUS inquiry only: no negotiation, settlement, concessions,
 *    payment directions, or patient/client collections.
 *
 * REVIEW REQUIRED BEFORE PRODUCTION:
 *  - DISCLOSURE_FR is a faithful translation of the English script, not a
 *    legally reviewed text. Have counsel / a native French reviewer approve it
 *    (Quebec Law 25 and the Charter of the French Language apply to Quebec calls).
 *  - CANADIAN_CARRIER_CONTEXT holds general, public-knowledge context only. Real
 *    IVR menu wording, department names and hold behaviour per carrier are
 *    UNVERIFIED and must be confirmed with shadow calls
 *    (voice-agent-sim/SHADOW-CALL-VALIDATION-PROTOCOL-*.md) before live dispatch.
 *  - No carrier phone numbers live here. Outbound calls go only to numbers on
 *    the CARRIER_PHONE_MAP allowlist in src/vapi/client.ts.
 */

import type { IndustryType } from '../types/industry-claims';

export type PromptLanguage = 'en' | 'fr';

// ── Disclosure ───────────────────────────────────────────────────────────────

export const DISCLOSURE_EN =
  "Thank you for taking my call. I am an automated calling system on behalf of {{practice_name}}'s billing department. " +
  'You can reach us at {{practice_phone}}. This call may be recorded for quality purposes. ' +
  'I am following up on a claim that was submitted {{days_outstanding}} days ago.';

export const DISCLOSURE_FR =
  'Merci de prendre mon appel. Je suis un système d\'appel automatisé qui appelle au nom du service de facturation de {{practice_name}}. ' +
  'Vous pouvez nous joindre au {{practice_phone}}. Cet appel peut être enregistré à des fins de qualité. ' +
  'Je fais le suivi d\'une réclamation soumise il y a {{days_outstanding}} jours.';

export const DISCLOSURES: Record<PromptLanguage, string> = { en: DISCLOSURE_EN, fr: DISCLOSURE_FR };

// ── Telephony timing (from the Collect-RX blueprint, section 3) ──────────────

export const IVR_TIMING = {
  /** Silence required after an IVR prompt finishes before sending DTMF. */
  silenceBeforeDtmfMs: 800,
  interDigitDelayMs: 250,
  speechWordsPerMinute: 145,
  /** Pause around numbers, dates and spelled sequences. */
  numberPauseMs: { min: 300, max: 500 },
  minPromptConfidence: 0.75,
  /** Re-plays of the primary response before asking for a representative. */
  maxReplays: 1,
  maxLoopsBeforeDisconnect: 3,
  holdSentinel: { windowMs: 200, minSignalMs: 400, resumeWithinMs: 150 },
} as const;

// ── Bilingual IVR classification ─────────────────────────────────────────────

export type IvrIntent =
  | 'language_select'
  | 'provider_menu'
  | 'claim_status_menu'
  | 'enter_claim_number'
  | 'enter_provider_id'
  | 'representative'
  | 'hold_notice'
  | 'unknown';

interface IvrPattern {
  intent: IvrIntent;
  en: RegExp;
  fr: RegExp;
}

/** Order matters: the first match wins. Patterns run on lowercased, accent-folded text. */
const IVR_PATTERNS: readonly IvrPattern[] = [
  {
    intent: 'language_select',
    en: /\bfor english\b|\bfrench,? press\b|\bpress \d for (english|french)\b/,
    fr: /\bpour le francais\b|\bpour (service )?en francais\b|\bfrancais,? (appuyez|composez)\b/,
  },
  {
    intent: 'hold_notice',
    en: /\byour call is (very )?important\b|\bplease (stay|remain) on the line\b|\bnext available (agent|representative)\b|\bhigher than normal call volume\b/,
    fr: /\bvotre appel est (tres )?important\b|\bveuillez (rester|patienter)\b|\bprochain (agent|representant) disponible\b|\bvolume d'appels eleve\b/,
  },
  {
    intent: 'enter_claim_number',
    en: /\b(enter|key in|say) (the |your )?(claim|reference|file|job|repair order|policy) (number|#)\b/,
    fr: /\b(entrez|saisissez|composez|dites|veuillez (entrer|saisir|composer|dire)) (le |votre )?(numero de |no\.? de |no )?(reclamation|dossier|police|reference|sinistre)\b/,
  },
  {
    intent: 'enter_provider_id',
    en: /\b(enter|key in) (the |your )?(provider|tax|business|registration|billing|facility) (id|number|#)\b|\bbusiness number\b/,
    fr: /\b(entrez|saisissez|composez|veuillez (entrer|saisir|composer)) (le |votre )?(numero de )?(fournisseur|entreprise|facturation|inscription)\b/,
  },
  {
    intent: 'claim_status_menu',
    en: /\bclaim status\b|\bstatus of (a|your) claim\b|\bcheck (a )?claim\b/,
    fr: /\bstatut d(e|'une) (la )?reclamation\b|\betat d(e|'une) (la )?reclamation\b|\bverifier une reclamation\b|\bsuivi d(e|'une) reclamation\b/,
  },
  {
    intent: 'provider_menu',
    en: /\bif you are (a )?(provider|dentist|clinician|health ?care provider|service provider|repair|contractor|vendor)\b|\bfor (providers?|service providers?|repair facilities|contractors)\b/,
    fr: /\bsi vous etes (un )?(fournisseur|dentiste|clinicien|prestataire|reparateur|entrepreneur)\b|\bpour les (fournisseurs|prestataires|carrossiers|entrepreneurs)\b/,
  },
  {
    intent: 'representative',
    en: /\b(speak|talk) (to|with) (a |an )?(representative|agent|adjuster|advisor|specialist)\b|\bfor (a |an )?(representative|agent)\b/,
    fr: /\bparler a (un |une )?(representant|agent|expert en sinistres|conseiller|specialiste)\b|\bpour (un |une )?(representant|agent)\b/,
  },
];

const foldAccents = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/’/g, "'");

/**
 * Classify one IVR prompt transcript. Deterministic fallback for the LLM
 * navigator: when this returns `unknown`, follow the unrecognised-prompt routine
 * in IVR_RULES_PROMPT. Language is reported by which pattern set matched.
 */
export function classifyIvrPrompt(transcript: string): { intent: IvrIntent; language: PromptLanguage | null } {
  const t = foldAccents(transcript);
  for (const p of IVR_PATTERNS) {
    if (p.en.test(t)) return { intent: p.intent, language: 'en' };
    if (p.fr.test(t)) return { intent: p.intent, language: 'fr' };
  }
  return { intent: 'unknown', language: null };
}

/** Spoken fallback to reach a person, by language. */
export const REPRESENTATIVE_UTTERANCE: Record<PromptLanguage, string> = { en: 'Representative', fr: 'Représentant' };

// ── Shared prompt blocks ─────────────────────────────────────────────────────

export const SCOPE_RULES_PROMPT = `
SCOPE (non-negotiable):
- You are checking the STATUS of an already submitted claim and reporting what you learn.
- Never negotiate, settle, accept or request concessions, reduce balances, or tell the payer how or where to send money.
- Never discuss collecting from the patient or client.
- If asked whether you are an AI or automated system, say yes plainly. Never claim to be human.
- Only give the identifiers the representative asks for to locate the claim. Never read out more personal information than needed.
- If the representative declines to speak with an automated system, thank them, end the call politely, and report REP_AI_REFUSAL.
- Record: claim status, any denial or pend reason in the payer's own words, payment amount, cheque or EFT reference, payment date, documents requested, and the representative's name or ID.
`.trim();

export const IVR_RULES_PROMPT = `
IVR NAVIGATION (English and French trees):
- Say nothing about being automated to an IVR system. Disclosure happens only when a live person answers.
- Let every prompt finish. Wait ${IVR_TIMING.silenceBeforeDtmfMs} ms of silence before sending DTMF, with ${IVR_TIMING.interDigitDelayMs} ms between digits.
- Language menus: if the prompt offers "For English press 1, pour le français appuyez sur 2" (or similar), choose the language in {{preferred_language}} (default English). Do not guess the digit; use the digit the prompt states for that language.
- If the tree is French only, continue in French. If it switches language mid-call, follow it. Use the French disclosure when the representative speaks French.
- Choose the provider, repair facility, contractor, or claims status branch, never the policyholder or member branch.
- Enter identifiers as digits only when asked (claim number, provider or business number). If a prompt cannot be classified with at least ${IVR_TIMING.minPromptConfidence * 100}% confidence, repeat your response once. If it still fails, send 0 or say "Representative" / "Représentant".
- If the menu loops ${IVR_TIMING.maxLoopsBeforeDisconnect} times without progress, hang up and report IVR_LOOP so the claim goes to manual follow-up.
- During hold, stay silent. When a live person answers, deliver the disclosure for their language immediately, then continue.
- If the system asks you to send a fax or use a portal, record the instruction and end the call. Report FAX_OR_PORTAL_REQUIRED.
`.trim();

// ── Carrier context ──────────────────────────────────────────────────────────

export interface CarrierContext {
  displayName: string;
  /** Verticals this payer is relevant to. */
  industries: readonly IndustryType[];
  /** Short, general context for the agent. Unverified specifics are not included. */
  notes: string;
  /** French-language service is commonly offered; still confirm per call. */
  bilingualLikely: boolean;
  /** True once shadow-call validation has confirmed the menu path for this payer. */
  ivrVerified: false;
}

export const CANADIAN_CARRIER_CONTEXT: Record<string, CarrierContext> = {
  // Auto
  intact: { displayName: 'Intact Insurance', industries: ['AUTO_COLLISION', 'PROPERTY_RESTORATION', 'ROOFING_TRADES'], notes: 'Large private P&C insurer. Claims are identified by claim number; shops usually deal with an assigned appraiser or adjuster.', bilingualLikely: true, ivrVerified: false },
  aviva: { displayName: 'Aviva Canada', industries: ['AUTO_COLLISION', 'PROPERTY_RESTORATION', 'ROOFING_TRADES'], notes: 'Private P&C insurer. Confirm whether the claim sits with an appraiser, adjuster, or a direct-repair program contact.', bilingualLikely: true, ivrVerified: false },
  desjardins: { displayName: 'Desjardins Insurance', industries: ['AUTO_COLLISION', 'PROPERTY_RESTORATION', 'ROOFING_TRADES'], notes: 'Quebec-based insurer. Expect French as the default language of the tree and representative.', bilingualLikely: true, ivrVerified: false },
  cooperators: { displayName: 'Co-operators', industries: ['AUTO_COLLISION', 'PROPERTY_RESTORATION', 'ROOFING_TRADES'], notes: 'Private P&C insurer. Ask which adjuster or appraiser owns the claim.', bilingualLikely: true, ivrVerified: false },
  icbc: { displayName: 'ICBC', industries: ['AUTO_COLLISION'], notes: 'British Columbia public basic auto insurer. Repair payment status is tied to the ICBC claim number and the repair facility.', bilingualLikely: false, ivrVerified: false },
  sgi: { displayName: 'SGI', industries: ['AUTO_COLLISION'], notes: 'Saskatchewan public auto insurer. Identify the claim by claim number and the repair facility.', bilingualLikely: false, ivrVerified: false },
  mpi: { displayName: 'Manitoba Public Insurance (MPI)', industries: ['AUTO_COLLISION'], notes: 'Manitoba public auto insurer. Identify the claim by claim number and the repair facility.', bilingualLikely: true, ivrVerified: false },
  // Property
  wawanesa: { displayName: 'Wawanesa Insurance', industries: ['PROPERTY_RESTORATION', 'ROOFING_TRADES', 'AUTO_COLLISION'], notes: 'Private P&C insurer. Ask whether the estimate has been reviewed and whether the payee list includes a mortgagee.', bilingualLikely: false, ivrVerified: false },
  // Health, dental, paramedical
  sun_life: { displayName: 'Sun Life', industries: ['DENTAL', 'PARAMEDICAL_PHYSIO'], notes: 'Group benefits and dental. Provider claim status is requested with the provider number and claim reference.', bilingualLikely: true, ivrVerified: false },
  canada_life: { displayName: 'Canada Life', industries: ['DENTAL', 'PARAMEDICAL_PHYSIO'], notes: 'Group benefits and dental.', bilingualLikely: true, ivrVerified: false },
  manulife: { displayName: 'Manulife', industries: ['DENTAL', 'PARAMEDICAL_PHYSIO'], notes: 'Group benefits and dental. Language selection is offered at the start of the call.', bilingualLikely: true, ivrVerified: false },
  green_shield: { displayName: 'Green Shield Canada (GSC)', industries: ['DENTAL', 'PARAMEDICAL_PHYSIO'], notes: 'Benefits administrator for many plans.', bilingualLikely: true, ivrVerified: false },
  cdcp: { displayName: 'Canadian Dental Care Plan (CDCP)', industries: ['DENTAL'], notes: 'Federal plan administered by Sun Life, with its own contact centre separate from Sun Life group benefits. Co-pay tier and provincial secondary coverage can affect the amount payable.', bilingualLikely: true, ivrVerified: false },
  wsib: { displayName: 'WSIB (Ontario)', industries: ['PARAMEDICAL_PHYSIO', 'DME', 'NEMT'], notes: 'Workplace injury board. Claims are identified by the WSIB claim number and the worker; treatment must be authorized by the board.', bilingualLikely: true, ivrVerified: false },
  wcb: { displayName: 'Provincial workers\' compensation board (WCB, WorkSafeBC, CNESST)', industries: ['PARAMEDICAL_PHYSIO', 'DME', 'NEMT'], notes: 'Rules and departments differ by province. Confirm the board\'s name and the claim number format at the start.', bilingualLikely: true, ivrVerified: false },
};

export function carrierContextBlock(carrierKey: string | undefined): string {
  if (!carrierKey) return '';
  const c = CANADIAN_CARRIER_CONTEXT[carrierKey];
  if (!c) return '';
  return `PAYER CONTEXT: ${c.displayName}. ${c.notes}${c.bilingualLikely ? ' French service is likely available; honour {{preferred_language}}.' : ''}`;
}

// ── Industry prompts ─────────────────────────────────────────────────────────

const ROLE = (who: string) =>
  `You are an automated claims status follow-up assistant calling a payer on behalf of ${who}. Your job is to find out where a submitted claim stands and report back.`;

export const INDUSTRY_PROMPTS: Record<IndustryType, string> = {
  DENTAL: `${ROLE('{{practice_name}}, a dental practice')}
Follow the dental flow in vapi-system-prompt.md. Provide the claim number {{claim_number}} and the provider details the payer asks for. Ask for status, any pend or denial reason, payment amount and date, and whether documents are needed.`,

  AUTO_COLLISION: `${ROLE('{{practice_name}}, a collision repair facility')}
Identify: repair order {{primary_reference}}, claim number {{claim_number}}, and give the vehicle identification number only if asked ({{secondary_reference}}).
Ask, in order:
1. Has the estimate or supplement {{supplement_label}} been approved by the appraiser or adjuster?
2. If approved, has payment been issued to the repair facility, and what is the cheque or EFT reference and date?
3. If not approved or pended, what is outstanding (photos, a revised estimate, a final invoice, a parts invoice, a calibration or scan report)? Ask for the adjuster's direct email and record it.
Do not discuss deductibles, total-loss valuations, or fault.`,

  PROPERTY_RESTORATION: `${ROLE('{{practice_name}}, a property restoration contractor')}
Identify: job number {{primary_reference}}, claim number {{claim_number}}, and give the policy number only if asked ({{secondary_reference}}).
Ask, in order:
1. Has the estimate (Xactimate or Symbility) {{estimate_id}} been received and assigned to an adjuster?
2. Are the emergency mitigation line items approved, and is any scope under review or disputed?
3. Has payment been issued, who are the payees (contractor, insured, mortgagee), and what is the cheque or EFT reference and date?
Do not discuss coverage decisions, scope negotiation, or settlement.`,

  PARAMEDICAL_PHYSIO: `${ROLE('{{practice_name}}, a paramedical or physiotherapy clinic')}
Identify: invoice or claim number {{claim_number}}, clinic provider number {{provider_number}}, and the patient or member details only as the payer asks.
Ask, in order:
1. Has the claim been received and adjudicated, and what is the status?
2. If pended or denied, what is the stated reason? Is it a visit limit, an authorization or referral requirement, a coverage exclusion, or missing documentation?
3. If paid, what is the amount, the cheque or EFT reference, and the date? If unpaid, what is the expected payment date?
For workers' compensation payers, also confirm the treatment was authorized and whether progress reports are outstanding.`,

  DME: `${ROLE('{{practice_name}}, a medical equipment supplier')}
Identify: sales order {{primary_reference}}, claim or authorization number {{claim_number}}.
Ask, in order:
1. Has the claim or invoice been received, and what is the status?
2. If pended or denied, is documentation outstanding (prescription, assessment, authorization, proof of delivery)?
3. If paid, what is the amount, reference, and date? For recurring rentals, which billing periods are covered?`,

  ROOFING_TRADES: `${ROLE('{{practice_name}}, a roofing or trades contractor')}
Identify: job number {{primary_reference}}, claim number {{claim_number}}, and the policy number only if asked ({{secondary_reference}}).
Ask, in order:
1. Has the completion certificate or final invoice been accepted?
2. Have withheld recoverable depreciation or replacement-cost holdback funds been released?
3. Has payment been issued, who are the payees (including any mortgagee), and what is the cheque or EFT reference and date?
Do not discuss scope disputes beyond recording what the payer says is outstanding.`,

  NEMT: `${ROLE('{{practice_name}}, a non-emergency medical transportation provider')}
Identify: trip or run number {{primary_reference}}, invoice or claim number {{claim_number}}, and the authorization number if asked ({{secondary_reference}}).
Ask, in order:
1. Has the invoice been received and authorized against the trip?
2. If pended or denied, is it trip documentation (mileage, route log, signed trip record), authorization, or eligibility?
3. If paid, what is the amount, reference, and date? If unpaid, when is the next payment run?`,
};

// ── Builder ──────────────────────────────────────────────────────────────────

export interface BuildPromptOptions {
  industryType: IndustryType;
  /** Key into CANADIAN_CARRIER_CONTEXT, for example "intact" or "cdcp". */
  carrierKey?: string;
  language?: PromptLanguage;
}

/**
 * Assemble the system prompt for one call. The disclosure is the first thing the
 * agent says to a live person; the IVR rules keep it silent until then.
 */
export function buildVoicePrompt(options: BuildPromptOptions): string {
  const language = options.language ?? 'en';
  return [
    INDUSTRY_PROMPTS[options.industryType],
    carrierContextBlock(options.carrierKey),
    `MANDATORY DISCLOSURE (say this first to a live person, in their language):\nEnglish: "${DISCLOSURE_EN}"\nFrançais: "${DISCLOSURE_FR}"\nStart in: ${language === 'fr' ? 'French' : 'English'}.`,
    IVR_RULES_PROMPT,
    SCOPE_RULES_PROMPT,
  ]
    .filter(Boolean)
    .join('\n\n');
}
