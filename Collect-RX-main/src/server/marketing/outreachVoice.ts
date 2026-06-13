/**
 * CollectRx partnerships outreach — voice, copy rules, and capability catalog.
 *
 * TONE
 * - Calm, direct B2B. Plain sentences. No em dashes.
 * - Canadian dental context. Short paragraphs. One clear ask per email.
 * - Insurance AR only (not patient balances).
 *
 * NEVER (pre-social-proof phase)
 * - Fake warm intros ("a colleague mentioned you", "practices in {city} we work with")
 * - Implied case studies or results we have not measured
 * - "I hope this finds you well", hype, exclamation marks, em dashes, AI filler phrases
 */

export const OUTREACH_SIGNOFF = 'The CollectRx team';

export type CapabilityTier = 'core' | 'operational' | 'trust' | 'proof';

export interface CapabilityPoint {
  id: string;
  headline: string;
  emailLine: string;
  tier: CapabilityTier;
  cadenceSteps: number[];
  enabled: boolean;
}

export const CAPABILITY_CATALOG: CapabilityPoint[] = [
  {
    id: 'doubleBurden',
    headline: 'Double burden on unresolved AR',
    emailLine:
      'Unresolved insurance AR costs twice: staff hours on carrier hold lines, and revenue from outstanding balances that never gets collected.',
    tier: 'core',
    cadenceSteps: [1, 4],
    enabled: true,
  },
  {
    id: 'collectWithoutStaffTime',
    headline: 'Background collection',
    emailLine:
      'CollectRx runs insurance follow-up in the background. Less time on hold, and outstanding balances move toward collection instead of aging out.',
    tier: 'core',
    cadenceSteps: [1],
    enabled: true,
  },
  {
    id: 'revenueAlreadyEarned',
    headline: 'Revenue already earned',
    emailLine:
      'Outstanding insurance AR is money the practice has already earned. It should not sit unresolved because nobody has hours for follow-up.',
    tier: 'core',
    cadenceSteps: [],
    enabled: true,
  },
  {
    id: 'carrierAutomation',
    headline: 'Carrier automation',
    emailLine:
      'Automated calls to Sun Life, Canada Life, Manulife, Green Shield, RBC, and TELUS AdjudiCare. IVR navigation, claim status, and next steps on a set schedule.',
    tier: 'operational',
    cadenceSteps: [1, 2],
    enabled: true,
  },
  {
    id: 'liveStatus',
    headline: 'Live claim status',
    emailLine:
      'When a carrier call finishes, claim status updates in your queue. You see what is moving without checking each insurer manually.',
    tier: 'operational',
    cadenceSteps: [2],
    enabled: true,
  },
  {
    id: 'pmsFlexible',
    headline: 'PMS-flexible start',
    emailLine:
      'Works with your existing practice management software. Start from an outstanding-claims export. No vendor API or IT project.',
    tier: 'operational',
    cadenceSteps: [1, 2],
    enabled: true,
  },
  {
    id: 'denialAndCdcp',
    headline: 'Denial handling',
    emailLine:
      'Denied claims capture reason codes and resubmission steps, including Canadian Dental Care Plan reconsideration where that plan applies.',
    tier: 'operational',
    cadenceSteps: [3],
    enabled: true,
  },
  {
    id: 'visibility',
    headline: 'Action queue',
    emailLine:
      'You see which claims are moving, which need office action, and what is still outstanding, without manually checking each carrier.',
    tier: 'operational',
    cadenceSteps: [2, 3],
    enabled: true,
  },
  {
    id: 'collectionsMetrics',
    headline: 'Collections metrics',
    emailLine:
      'Your PMS already shows insurance AR aging. CollectRx reports sync-verified dollars recovered, open outstanding, and claims in follow-up so you can compare results side by side.',
    tier: 'operational',
    cadenceSteps: [3],
    enabled: true,
  },
  {
    id: 'agedArRisk',
    headline: 'Aged AR risk',
    emailLine:
      'Claims that sit past normal adjudication windows are at risk of write-off. CollectRx keeps follow-up moving before balances become uncollectable.',
    tier: 'core',
    cadenceSteps: [3],
    enabled: true,
  },
  {
    id: 'compliance',
    headline: 'Privacy by design',
    emailLine:
      'Built for Canadian privacy expectations. Identifiers are tokenized before data is processed outside your controlled environment.',
    tier: 'trust',
    cadenceSteps: [3],
    enabled: true,
  },
  {
    id: 'businessHours',
    headline: 'Business hours only',
    emailLine:
      'Carrier calls run Monday to Friday, 8am to 5pm Eastern, scheduled and rate-limited at the system level.',
    tier: 'trust',
    cadenceSteps: [],
    enabled: true,
  },
  {
    id: 'socialProof',
    headline: 'Social proof',
    emailLine: process.env.MARKETING_SOCIAL_PROOF_LINE?.trim() || '',
    tier: 'proof',
    cadenceSteps: [4],
    enabled: process.env.MARKETING_SOCIAL_PROOF_ENABLED === 'true' && Boolean(process.env.MARKETING_SOCIAL_PROOF_LINE?.trim()),
  },
];

export const CAPABILITY_PILLARS = Object.fromEntries(
  CAPABILITY_CATALOG.filter((c) => c.enabled && c.tier !== 'proof').map((c) => [c.id, c.emailLine]),
) as Record<string, string>;

export function capabilitiesForCadenceStep(step: number): CapabilityPoint[] {
  return CAPABILITY_CATALOG.filter((c) => c.enabled && c.cadenceSteps.includes(step));
}

export function capabilityLinesForStep(step: number): string[] {
  return capabilitiesForCadenceStep(step).map((c) => c.emailLine);
}

export function formatCapabilityCatalogForReview(): string {
  const tiers: CapabilityTier[] = ['core', 'operational', 'trust', 'proof'];
  return tiers
    .map((tier) => {
      const items = CAPABILITY_CATALOG.filter((c) => c.tier === tier);
      const header = tier.toUpperCase();
      const lines = items.map(
        (c) =>
          `- **${c.headline}** (${c.enabled ? 'on' : 'off'}) emails ${c.cadenceSteps.length ? c.cadenceSteps.join(', ') : 'none'}\n  ${c.emailLine}`,
      );
      return `### ${header}\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

export function outreachGreeting(contactName: string | null | undefined): string {
  const first = contactName?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hi,';
}

export function coreProblemLine(practiceName: string): string {
  return `${practiceName} is carrying two costs on unresolved insurance AR: staff time on carrier phones, and revenue from outstanding balances that never gets collected.`;
}
