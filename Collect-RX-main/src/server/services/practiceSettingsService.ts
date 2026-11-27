import type { CarrierId, PrismaClient } from '@prisma/client';
import { CARRIER_CONFIGS } from '../../carriers/adapter.js';
import type { CarrierConfig, PracticeSettings, StaffAvailability } from '../../types/practiceSettings.js';
import { hhmmToMinutes } from '../frontDesk/staffAvailability.js';
import { normalizePmsVendorId } from '../pms/pmsRegistry.js';
import { isStaffedHours, validateStaffedHours } from '../../lib/staffedHours.js';

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
    providerNumber: '',
    authorizationSubmitted: false,
    authorizationSubmittedAt: null,
    authorizationConfirmationNumber: undefined,
    languagePreference: 'en' as const,
  }));
}

const DEFAULT_CARRIER_CONFIG_BY_ID = new Map(defaultCarrierConfigs().map((c) => [c.carrierId, c]));

/** Backfill fields added after a practice's settings were first saved (e.g. providerNumber). */
function normalizeCarrierConfig(raw: unknown): CarrierConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Partial<CarrierConfig>;
  const fallback = DEFAULT_CARRIER_CONFIG_BY_ID.get(c.carrierId as CarrierId);
  if (!fallback) return undefined;
  return { ...fallback, ...c };
}

export function defaultRetentionSettings(): PracticeSettings['retention'] {
  return {
    purgeEnabled: false,
    claimRetentionMonths: 12,
    auditLogRetentionMonths: 18,
    phiAccessEventRetentionMonths: 18,
  };
}

export function defaultPracticeSettings(): PracticeSettings {
  return {
    emailsEnabled: true,
    automationEnabled: true,
    sendFromPracticeEmail: false,
    voiceAgentEnabled: false,
    usageVisibleToOfficeManager: false,
    usageVisibleToBillingCoordinator: false,
    usageAlertEmailsEnabled: true,
    carrierConfigs: defaultCarrierConfigs(),
    callWindowStart: '08:00',
    callWindowEnd: '17:00',
    escalationPhoneNumber: '',
    telusTpaMappings: {},
    // V1 Hold Sentinel is the product sold first (ADR 0003), so new practices
    // start in it; staff speak with the rep, the AI never does.
    humanAssistedMode: true,
    retention: defaultRetentionSettings(),
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
    ...(typeof o.usageVisibleToOfficeManager === 'boolean'
      ? { usageVisibleToOfficeManager: o.usageVisibleToOfficeManager }
      : {}),
    ...(typeof o.usageVisibleToBillingCoordinator === 'boolean'
      ? { usageVisibleToBillingCoordinator: o.usageVisibleToBillingCoordinator }
      : {}),
    ...(typeof o.usageAlertEmailsEnabled === 'boolean'
      ? { usageAlertEmailsEnabled: o.usageAlertEmailsEnabled }
      : {}),
    ...(typeof o.planUsageAlertCycleKey === 'string'
      ? { planUsageAlertCycleKey: o.planUsageAlertCycleKey }
      : {}),
    ...(o.planUsageAlertsSent && typeof o.planUsageAlertsSent === 'object'
      ? { planUsageAlertsSent: o.planUsageAlertsSent as Record<string, boolean> }
      : {}),
    ...(typeof o.callWindowStart === 'string' ? { callWindowStart: o.callWindowStart } : {}),
    ...(typeof o.callWindowEnd === 'string' ? { callWindowEnd: o.callWindowEnd } : {}),
    ...(typeof o.escalationPhoneNumber === 'string'
      ? { escalationPhoneNumber: o.escalationPhoneNumber }
      : {}),
    ...(isStaffedHours(o.staffedHours) ? { staffedHours: o.staffedHours } : {}),
    ...(typeof o.designatedIndividualUserId === 'string' && o.designatedIndividualUserId
      ? { designatedIndividualUserId: o.designatedIndividualUserId }
      : {}),
    ...(typeof o.billingPhone === 'string' ? { billingPhone: o.billingPhone } : {}),
    ...(o.telusTpaMappings && typeof o.telusTpaMappings === 'object'
      ? { telusTpaMappings: o.telusTpaMappings as Record<string, string> }
      : {}),
    ...(typeof o.humanAssistedMode === 'boolean'
      ? { humanAssistedMode: o.humanAssistedMode }
      : {}),
    ...(typeof o.humanAssistedAllowsOldClaims === 'boolean'
      ? { humanAssistedAllowsOldClaims: o.humanAssistedAllowsOldClaims }
      : {}),
    ...(Array.isArray(o.escalationFallbackNumbers)
      ? { escalationFallbackNumbers: o.escalationFallbackNumbers.filter((n): n is string => typeof n === 'string').slice(0, 3) }
      : {}),
    ...(typeof o.staffTimeZone === 'string' ? { staffTimeZone: o.staffTimeZone } : {}),
    ...(typeof o.listenerConsentAcknowledged === 'boolean'
      ? { listenerConsentAcknowledged: o.listenerConsentAcknowledged }
      : {}),
    ...(o.staffAvailability && typeof o.staffAvailability === 'object'
      ? { staffAvailability: o.staffAvailability as StaffAvailability }
      : {}),
    ...(Array.isArray(o.carrierConfigs)
      ? {
          carrierConfigs: o.carrierConfigs
            .map(normalizeCarrierConfig)
            .filter((c): c is CarrierConfig => c !== undefined),
        }
      : {}),
    ...(typeof o.pmsVendor === 'string'
      ? (() => {
          const v = normalizePmsVendorId(o.pmsVendor);
          return v ? { pmsVendor: v } : {};
        })()
      : {}),
    ...(o.pmsIngestMode === 'csv' ||
    o.pmsIngestMode === 'desktop_connector' ||
    o.pmsIngestMode === 'unknown'
      ? { pmsIngestMode: o.pmsIngestMode }
      : {}),
    ...(o.retention && typeof o.retention === 'object'
      ? { retention: normalizeRetentionSettings(o.retention) }
      : {}),
  };
}

/** Backfill/clamp retention fields added after a practice's settings were first saved. */
function normalizeRetentionSettings(raw: unknown): PracticeSettings['retention'] {
  const base = defaultRetentionSettings();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<PracticeSettings['retention']>;
  const positiveInt = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
  return {
    purgeEnabled: typeof o.purgeEnabled === 'boolean' ? o.purgeEnabled : base.purgeEnabled,
    claimRetentionMonths: positiveInt(o.claimRetentionMonths, base.claimRetentionMonths),
    auditLogRetentionMonths: positiveInt(o.auditLogRetentionMonths, base.auditLogRetentionMonths),
    phiAccessEventRetentionMonths: positiveInt(
      o.phiAccessEventRetentionMonths,
      base.phiAccessEventRetentionMonths,
    ),
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
  // L-4: string comparison is intentionally correct here. The HHMM regex above
  // enforces zero-padded HH:MM format, so lexicographic order matches
  // chronological order within the valid range. This is NOT a general pattern —
  // it only works because the format is strictly validated before this line.
  if (start < '08:00') return 'callWindowStart cannot be before 08:00 Eastern';
  if (end > '17:00') return 'callWindowEnd cannot be after 17:00 Eastern';
  if (start >= end) return 'callWindowStart must be before callWindowEnd';
  if (body.escalationPhoneNumber && body.escalationPhoneNumber.trim()) {
    if (!E164.test(body.escalationPhoneNumber.trim())) {
      return 'escalationPhoneNumber must be valid E.164 (+1...)';
    }
  }
  if (body.listenerConsentAcknowledged !== undefined && typeof body.listenerConsentAcknowledged !== 'boolean') {
    return 'listenerConsentAcknowledged must be a boolean';
  }
  if (body.humanAssistedAllowsOldClaims !== undefined && typeof body.humanAssistedAllowsOldClaims !== 'boolean') {
    return 'humanAssistedAllowsOldClaims must be a boolean';
  }
  if (body.escalationFallbackNumbers !== undefined) {
    const f = body.escalationFallbackNumbers as unknown;
    if (!Array.isArray(f) || f.length > 3 || !f.every((n) => typeof n === 'string' && /^\+[1-9]\d{7,14}$/.test(n))) {
      return 'escalationFallbackNumbers must be up to 3 E.164 numbers';
    }
  }
  if (body.staffTimeZone !== undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: String(body.staffTimeZone) });
    } catch {
      return 'staffTimeZone must be a valid IANA time zone';
    }
  }
  if (body.staffAvailability !== undefined) {
    const sa = body.staffAvailability as StaffAvailability;
    if (!sa || typeof sa !== 'object' || !Array.isArray(sa.windows)) {
      return 'staffAvailability.windows must be an array';
    }
    if (sa.windows.length > 14) return 'staffAvailability allows at most 14 windows';
    const lead = sa.leadMinutes ?? 15;
    const tail = sa.tailMinutes ?? 30;
    if (!Number.isInteger(lead) || lead < 0 || lead > 60) return 'staffAvailability.leadMinutes must be 0 to 60';
    if (!Number.isInteger(tail) || tail < 0 || tail > 120) return 'staffAvailability.tailMinutes must be 0 to 120';
    if (sa.pausedUntil != null && (typeof sa.pausedUntil !== 'string' || Number.isNaN(Date.parse(sa.pausedUntil)))) {
      return 'staffAvailability.pausedUntil must be an ISO date string or null';
    }
    for (const w of sa.windows) {
      if (!Array.isArray(w.days) || w.days.length === 0 || !w.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 5)) {
        return 'staffAvailability window days must be integers 1 (Mon) to 5 (Fri)';
      }
      if (!HHMM.test(w.start) || !HHMM.test(w.end)) return 'staffAvailability window times must be HH:MM';
      if (w.start >= w.end) return 'staffAvailability window start must be before end';
      if (hhmmToMinutes(w.end) - tail <= hhmmToMinutes(w.start) - lead) {
        return 'staffAvailability window is too short for the lead and tail minutes';
      }
    }
  }
  if (body.billingPhone && body.billingPhone.trim()) {
    if (!E164.test(body.billingPhone.trim())) {
      return 'billingPhone must be valid E.164 (+1...)';
    }
  }
  if (body.staffedHours !== undefined) {
    const staffedErr = validateStaffedHours(body.staffedHours);
    if (staffedErr) return staffedErr;
  }
  if (body.designatedIndividualUserId !== undefined && typeof body.designatedIndividualUserId !== 'string') {
    return 'designatedIndividualUserId must be a user id';
  }
  if (body.pmsVendor !== undefined) {
    if (!normalizePmsVendorId(body.pmsVendor)) {
      return 'pmsVendor is not a supported practice management system';
    }
  }
  if (body.pmsIngestMode !== undefined) {
    const modes = ['csv', 'desktop_connector', 'unknown'] as const;
    if (!modes.includes(body.pmsIngestMode as (typeof modes)[number])) {
      return 'pmsIngestMode must be csv, desktop_connector, or unknown';
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
      if (c.providerNumber !== undefined) {
        if (typeof c.providerNumber !== 'string' || c.providerNumber.length > 50) {
          return `${c.carrierId} providerNumber must be a string of at most 50 characters`;
        }
      }
      if (c.authorizationSubmitted !== undefined && typeof c.authorizationSubmitted !== 'boolean') {
        return `${c.carrierId} authorizationSubmitted must be a boolean`;
      }
      if (c.authorizationSubmittedAt !== undefined && c.authorizationSubmittedAt !== null) {
        if (typeof c.authorizationSubmittedAt !== 'string' || Number.isNaN(Date.parse(c.authorizationSubmittedAt))) {
          return `${c.carrierId} authorizationSubmittedAt must be an ISO date string or null`;
        }
      }
      if (c.authorizationConfirmationNumber !== undefined) {
        if (typeof c.authorizationConfirmationNumber !== 'string' || c.authorizationConfirmationNumber.length > 100) {
          return `${c.carrierId} authorizationConfirmationNumber must be a string of at most 100 characters`;
        }
      }
      if (c.languagePreference !== undefined) {
        if (c.languagePreference !== 'en' && c.languagePreference !== 'fr') {
          return `${c.carrierId} languagePreference must be 'en' or 'fr'`;
        }
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
  if (patch.designatedIndividualUserId) {
    // A designated individual from another practice, or a deactivated user, would
    // send this practice's alerts and transferred calls to the wrong person.
    const designated = await prisma.user.findFirst({
      where: { id: patch.designatedIndividualUserId, practiceId, isActive: true },
      select: { id: true },
    });
    if (!designated) throw new Error('designatedIndividualUserId must be an active user of this practice');
  }
  const current = await getPracticeSettings(prisma, practiceId);
  const merged: PracticeSettings = { ...current, ...patch };
  await prisma.practice.update({
    where: { id: practiceId },
    data: { settings: merged as object },
  });
  return merged;
}
