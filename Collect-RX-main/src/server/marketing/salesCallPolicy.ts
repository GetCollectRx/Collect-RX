import type { PrismaClient, Prospect } from '@prisma/client';
import { timezoneForProspect } from './sendWindow.js';

/**
 * Policy gate for CollectRx's own AI voice sales calls to prospects.
 *
 * Implements controls from docs/legal-policy/07-marketing-compliance-policy.md for
 * CRTC Unsolicited Telecommunications Rules obligations: express consent before a
 * telemarketing call via an automatic dialing-announcing device (Part IV s.2, s.3
 * and Part V), no telemarketing to healthcare facilities (Part III s.28), and
 * telemarketing hours in the recipient's local time (Part III s.23). Whether an
 * LLM voice agent is an ADAD is an open CRTC question (Notice 2026-132 Q2); the
 * gate builds to the stricter reading.
 *
 * Fail closed: the feature is off unless MARKETING_AI_SALES_CALLS_ENABLED is set,
 * and every prospect today is a dental practice, so calls also stay off until the
 * founder records a signed reading on "healthcare facility".
 */

export const AI_SALES_CALLS_ENABLED_ENV = 'MARKETING_AI_SALES_CALLS_ENABLED';
export const HEALTHCARE_FACILITY_READING_ENV = 'MARKETING_HEALTHCARE_FACILITY_READING_SIGNED';

export const ADAD_EXPRESS_CONSENT_ACTIVITY = 'adad_express_consent';
export const ADAD_CONSENT_WITHDRAWN_ACTIVITY = 'adad_consent_withdrawn';

/** Accepted forms of express consent, UTR Part V s.1(a) to (e). */
export const ACCEPTED_CONSENT_FORMS = [
  'written',
  'oral_third_party_verified',
  'oral_recorded',
  'electronic_toll_free',
  'electronic_internet',
  'documented_record',
] as const;

export type AcceptedConsentForm = (typeof ACCEPTED_CONSENT_FORMS)[number];

export type SalesCallPolicyCode =
  | 'AI_SALES_CALLS_DISABLED'
  | 'HEALTHCARE_FACILITY_READING_UNSIGNED'
  | 'NO_PHONE_ON_FILE'
  | 'ADAD_EXPRESS_CONSENT_MISSING'
  | 'ADAD_EXPRESS_CONSENT_WITHDRAWN'
  | 'ADAD_EXPRESS_CONSENT_INVALID'
  | 'OUTSIDE_TELEMARKETING_HOURS';

export type SalesCallPolicyDecision =
  | { allowed: true }
  | { allowed: false; code: SalesCallPolicyCode; reason: string };

const REASONS: Record<SalesCallPolicyCode, string> = {
  AI_SALES_CALLS_DISABLED:
    'AI voice sales calls are disabled. See docs/legal-policy/07-marketing-compliance-policy.md.',
  HEALTHCARE_FACILITY_READING_UNSIGNED:
    'Calls to dental offices stay blocked until the founder signs a reading on whether they are healthcare facilities (UTR Part III s.28).',
  NO_PHONE_ON_FILE: 'Prospect has no phone number.',
  ADAD_EXPRESS_CONSENT_MISSING:
    'No recorded express consent to receive automated calls for this number (UTR Part IV s.2).',
  ADAD_EXPRESS_CONSENT_WITHDRAWN: 'The prospect withdrew consent to automated calls.',
  ADAD_EXPRESS_CONSENT_INVALID:
    'The recorded consent does not name this number or is not in an accepted form (UTR Part IV s.3, Part V).',
  OUTSIDE_TELEMARKETING_HOURS:
    'Outside 9:00 to 21:30 weekdays or 10:00 to 18:00 weekends in the prospect\'s local time (UTR Part III s.23).',
};

export class SalesCallPolicyError extends Error {
  constructor(
    readonly code: SalesCallPolicyCode,
    message: string,
  ) {
    super(message);
    this.name = 'SalesCallPolicyError';
  }
}

function deny(code: SalesCallPolicyCode): SalesCallPolicyDecision {
  return { allowed: false, code, reason: REASONS[code] };
}

function flagOn(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name];
  return raw === '1' || raw === 'true';
}

function phoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function isAcceptedForm(value: unknown): value is AcceptedConsentForm {
  return typeof value === 'string' && (ACCEPTED_CONSENT_FORMS as readonly string[]).includes(value);
}

function readConsentMetadata(metadata: unknown): { phone: string | null; form: unknown } {
  if (typeof metadata !== 'object' || metadata === null) return { phone: null, form: null };
  const record = metadata as Record<string, unknown>;
  const phone = typeof record.phone === 'string' ? record.phone : null;
  return { phone, form: record.form };
}

/** True when `now` is inside UTR Part III s.23 hours in the prospect's local time zone. */
export function isWithinTelemarketingHours(
  prospect: Pick<Prospect, 'province'>,
  now: Date = new Date(),
): boolean {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezoneForProspect(prospect),
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const minutes = hour * 60 + minute;
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const start = isWeekend ? 10 * 60 : 9 * 60;
  const end = isWeekend ? 18 * 60 : 21 * 60 + 30;
  return minutes >= start && minutes < end;
}

export async function evaluateSalesCallPolicy(
  prisma: PrismaClient,
  prospect: Prospect,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<SalesCallPolicyDecision> {
  if (!flagOn(env, AI_SALES_CALLS_ENABLED_ENV)) return deny('AI_SALES_CALLS_DISABLED');
  if (!flagOn(env, HEALTHCARE_FACILITY_READING_ENV)) return deny('HEALTHCARE_FACILITY_READING_UNSIGNED');
  if (!prospect.phone?.trim()) return deny('NO_PHONE_ON_FILE');

  const latest = await prisma.prospectActivity.findFirst({
    where: {
      prospectId: prospect.id,
      type: { in: [ADAD_EXPRESS_CONSENT_ACTIVITY, ADAD_CONSENT_WITHDRAWN_ACTIVITY] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) return deny('ADAD_EXPRESS_CONSENT_MISSING');
  if (latest.type === ADAD_CONSENT_WITHDRAWN_ACTIVITY) return deny('ADAD_EXPRESS_CONSENT_WITHDRAWN');

  const consent = readConsentMetadata(latest.metadata);
  if (!consent.phone || phoneDigits(consent.phone) !== phoneDigits(prospect.phone)) {
    return deny('ADAD_EXPRESS_CONSENT_INVALID');
  }
  if (!isAcceptedForm(consent.form)) return deny('ADAD_EXPRESS_CONSENT_INVALID');

  if (!isWithinTelemarketingHours(prospect, now)) return deny('OUTSIDE_TELEMARKETING_HOURS');
  return { allowed: true };
}

/** Throws SalesCallPolicyError when the call must not be placed. */
export async function assertSalesCallPolicy(
  prisma: PrismaClient,
  prospect: Prospect,
  now: Date = new Date(),
): Promise<void> {
  const decision = await evaluateSalesCallPolicy(prisma, prospect, now);
  if (!decision.allowed) throw new SalesCallPolicyError(decision.code, decision.reason);
}
