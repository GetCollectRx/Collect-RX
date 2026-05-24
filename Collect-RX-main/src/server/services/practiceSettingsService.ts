import type { CarrierId, PrismaClient } from '@prisma/client';
import { CARRIER_CONFIGS } from '../../carriers/adapter.js';
import type { CarrierConfig, PracticeSettings } from '../../types/practiceSettings.js';

const DEFAULT_CARRIER_IDS = Object.keys(CARRIER_CONFIGS) as CarrierId[];

function defaultCarrierConfigs(): CarrierConfig[] {
  return DEFAULT_CARRIER_IDS.map((carrierId) => ({
    carrierId,
    enabled: true,
    minimumClaimAgeDays: carrierId === 'telus_adjudicare' ? 21 : 32,
    maxAttempts: 3,
    callWindowStart: '08:00',
    callWindowEnd: '17:00',
    notes: '',
  }));
}

export function defaultPracticeSettings(): PracticeSettings {
  return {
    emailsEnabled: true,
    automationEnabled: true,
    sendFromPracticeEmail: false,
    voiceAgentEnabled: false,
    carrierConfigs: defaultCarrierConfigs(),
    callWindowStart: '08:00',
    callWindowEnd: '17:00',
    escalationPhoneNumber: '',
    telusTpaMappings: {},
  };
}

export function parsePracticeSettings(raw: unknown): PracticeSettings {
  const base = defaultPracticeSettings();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  return {
    ...base,
    ...(typeof o.emailsEnabled === 'boolean' ? { emailsEnabled: o.emailsEnabled } : {}),
    ...(typeof o.automationEnabled === 'boolean' ? { automationEnabled: o.automationEnabled } : {}),
    ...(typeof o.sendFromPracticeEmail === 'boolean'
      ? { sendFromPracticeEmail: o.sendFromPracticeEmail }
      : {}),
    ...(typeof o.voiceAgentEnabled === 'boolean' ? { voiceAgentEnabled: o.voiceAgentEnabled } : {}),
    ...(typeof o.callWindowStart === 'string' ? { callWindowStart: o.callWindowStart } : {}),
    ...(typeof o.callWindowEnd === 'string' ? { callWindowEnd: o.callWindowEnd } : {}),
    ...(typeof o.escalationPhoneNumber === 'string'
      ? { escalationPhoneNumber: o.escalationPhoneNumber }
      : {}),
    ...(o.telusTpaMappings && typeof o.telusTpaMappings === 'object'
      ? { telusTpaMappings: o.telusTpaMappings as Record<string, string> }
      : {}),
    ...(Array.isArray(o.carrierConfigs)
      ? { carrierConfigs: o.carrierConfigs as CarrierConfig[] }
      : {}),
  };
}

export async function getPracticeSettings(
  prisma: PrismaClient,
  practiceId: string,
): Promise<PracticeSettings> {
  const row = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { settings: true },
  });
  return parsePracticeSettings(row?.settings);
}

const E164 = /^\+[1-9]\d{7,14}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validatePracticeSettingsUpdate(
  body: Partial<PracticeSettings>,
): string | null {
  if (body.callWindowStart && !HHMM.test(body.callWindowStart)) {
    return 'callWindowStart must be HH:MM';
  }
  if (body.callWindowEnd && !HHMM.test(body.callWindowEnd)) {
    return 'callWindowEnd must be HH:MM';
  }
  const start = body.callWindowStart ?? '08:00';
  const end = body.callWindowEnd ?? '17:00';
  if (start < '08:00') return 'callWindowStart cannot be before 08:00 Eastern';
  if (end > '17:00') return 'callWindowEnd cannot be after 17:00 Eastern';
  if (start >= end) return 'callWindowStart must be before callWindowEnd';
  if (body.escalationPhoneNumber && body.escalationPhoneNumber.trim()) {
    if (!E164.test(body.escalationPhoneNumber.trim())) {
      return 'escalationPhoneNumber must be valid E.164 (+1...)';
    }
  }
  if (body.carrierConfigs) {
    for (const c of body.carrierConfigs) {
      const min = c.minimumClaimAgeDays;
      const floor = c.carrierId === 'telus_adjudicare' ? 21 : 32;
      if (min < floor) {
        return `${c.carrierId} minimumClaimAgeDays must be at least ${floor}`;
      }
      if (c.maxAttempts < 1 || c.maxAttempts > 3) {
        return 'maxAttempts must be between 1 and 3';
      }
    }
  }
  return null;
}

export async function updatePracticeSettings(
  prisma: PrismaClient,
  practiceId: string,
  patch: Partial<PracticeSettings>,
): Promise<PracticeSettings> {
  const err = validatePracticeSettingsUpdate(patch);
  if (err) throw new Error(err);
  const current = await getPracticeSettings(prisma, practiceId);
  const merged: PracticeSettings = { ...current, ...patch };
  await prisma.practice.update({
    where: { id: practiceId },
    data: { settings: merged as object },
  });
  return merged;
}
