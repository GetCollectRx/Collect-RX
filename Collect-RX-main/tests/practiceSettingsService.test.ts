import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  defaultPracticeSettings,
  parsePracticeSettings,
  updatePracticeSettings,
  validatePracticeSettingsUpdate,
} from '../src/server/services/practiceSettingsService.js';
import { defaultStaffedHours } from '../src/lib/staffedHours.js';

describe('practiceSettingsService', () => {
  describe('defaultPracticeSettings', () => {
    it('seeds every carrier with empty authorization fields', () => {
      const settings = defaultPracticeSettings();
      expect(settings.carrierConfigs.length).toBeGreaterThan(0);
      for (const c of settings.carrierConfigs) {
        expect(c.providerNumber).toBe('');
        expect(c.authorizationSubmitted).toBe(false);
        expect(c.authorizationSubmittedAt).toBeNull();
      }
    });

    it('starts new practices in Hold Sentinel (human-assisted) mode', () => {
      expect(defaultPracticeSettings().humanAssistedMode).toBe(true);
    });

    it('keeps a practice that explicitly turned Hold Sentinel off', () => {
      expect(parsePracticeSettings({ humanAssistedMode: false }).humanAssistedMode).toBe(false);
    });

    it('defaults retention purging to disabled with 12/18/18-month windows', () => {
      const settings = defaultPracticeSettings();
      expect(settings.retention).toEqual({
        purgeEnabled: false,
        claimRetentionMonths: 12,
        auditLogRetentionMonths: 18,
        phiAccessEventRetentionMonths: 18,
      });
    });
  });

  describe('parsePracticeSettings', () => {
    it('backfills providerNumber/authorizationSubmitted on carrier configs saved before those fields existed', () => {
      const legacy = {
        carrierConfigs: [
          {
            carrierId: 'sun_life',
            enabled: true,
            minimumClaimAgeDays: 32,
            maxAttempts: 3,
            callWindowStart: '08:00',
            callWindowEnd: '17:00',
            notes: 'legacy entry',
          },
        ],
      };
      const settings = parsePracticeSettings(legacy);
      const sunLife = settings.carrierConfigs.find((c) => c.carrierId === 'sun_life');
      expect(sunLife).toMatchObject({
        notes: 'legacy entry',
        providerNumber: '',
        authorizationSubmitted: false,
        authorizationSubmittedAt: null,
      });
    });

    it('preserves providerNumber/authorizationSubmitted already present in storage', () => {
      const saved = {
        carrierConfigs: [
          {
            carrierId: 'sun_life',
            enabled: true,
            minimumClaimAgeDays: 32,
            maxAttempts: 3,
            callWindowStart: '08:00',
            callWindowEnd: '17:00',
            notes: '',
            providerNumber: 'ON-123456',
            authorizationSubmitted: true,
            authorizationSubmittedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
      const settings = parsePracticeSettings(saved);
      const sunLife = settings.carrierConfigs.find((c) => c.carrierId === 'sun_life');
      expect(sunLife).toMatchObject({
        providerNumber: 'ON-123456',
        authorizationSubmitted: true,
        authorizationSubmittedAt: '2026-06-01T00:00:00.000Z',
      });
    });

    it('drops carrier config entries for unknown carrierIds', () => {
      const saved = {
        carrierConfigs: [
          { carrierId: 'not_a_real_carrier', enabled: true, minimumClaimAgeDays: 32, maxAttempts: 3 },
        ],
      };
      const settings = parsePracticeSettings(saved);
      expect(settings.carrierConfigs.find((c) => c.carrierId === ('not_a_real_carrier' as never))).toBeUndefined();
    });

    it('backfills default retention settings for practices saved before retention existed', () => {
      const settings = parsePracticeSettings({});
      expect(settings.retention).toEqual({
        purgeEnabled: false,
        claimRetentionMonths: 12,
        auditLogRetentionMonths: 18,
        phiAccessEventRetentionMonths: 18,
      });
    });

    it('honours a saved retention override', () => {
      const saved = { retention: { purgeEnabled: true, claimRetentionMonths: 24 } };
      const settings = parsePracticeSettings(saved);
      expect(settings.retention).toEqual({
        purgeEnabled: true,
        claimRetentionMonths: 24,
        auditLogRetentionMonths: 18,
        phiAccessEventRetentionMonths: 18,
      });
    });

    it('clamps a corrupt/non-positive retention value back to the default rather than persisting it', () => {
      const saved = { retention: { claimRetentionMonths: -5, auditLogRetentionMonths: 'forever' } };
      const settings = parsePracticeSettings(saved);
      expect(settings.retention.claimRetentionMonths).toBe(12);
      expect(settings.retention.auditLogRetentionMonths).toBe(18);
    });
  });

  describe('validatePracticeSettingsUpdate', () => {
    const base = defaultPracticeSettings();

    it('accepts a valid providerNumber and authorization update', () => {
      const carrierConfigs = base.carrierConfigs.map((c) =>
        c.carrierId === 'sun_life'
          ? { ...c, providerNumber: 'ON-123456', authorizationSubmitted: true, authorizationSubmittedAt: '2026-06-01T00:00:00.000Z' }
          : c,
      );
      expect(validatePracticeSettingsUpdate({ carrierConfigs })).toBeNull();
    });

    it('rejects a providerNumber over 50 characters', () => {
      const carrierConfigs = base.carrierConfigs.map((c) =>
        c.carrierId === 'sun_life' ? { ...c, providerNumber: 'x'.repeat(51) } : c,
      );
      expect(validatePracticeSettingsUpdate({ carrierConfigs })).toMatch(/providerNumber/);
    });

    it('rejects a non-boolean authorizationSubmitted', () => {
      const carrierConfigs = base.carrierConfigs.map((c) =>
        c.carrierId === 'sun_life' ? { ...c, authorizationSubmitted: 'yes' as unknown as boolean } : c,
      );
      expect(validatePracticeSettingsUpdate({ carrierConfigs })).toMatch(/authorizationSubmitted/);
    });

    it('rejects an unparsable authorizationSubmittedAt', () => {
      const carrierConfigs = base.carrierConfigs.map((c) =>
        c.carrierId === 'sun_life' ? { ...c, authorizationSubmittedAt: 'not-a-date' } : c,
      );
      expect(validatePracticeSettingsUpdate({ carrierConfigs })).toMatch(/authorizationSubmittedAt/);
    });

    it('accepts authorizationSubmittedAt: null', () => {
      const carrierConfigs = base.carrierConfigs.map((c) =>
        c.carrierId === 'sun_life' ? { ...c, authorizationSubmitted: false, authorizationSubmittedAt: null } : c,
      );
      expect(validatePracticeSettingsUpdate({ carrierConfigs })).toBeNull();
    });
  });
});

describe('staffed hours and the designated individual', () => {
  it('leaves staffed hours unset for a practice that never configured them', () => {
    expect(defaultPracticeSettings().staffedHours).toBeUndefined();
    expect(parsePracticeSettings({}).staffedHours).toBeUndefined();
  });

  it('keeps a saved schedule and the designated individual when settings are read back', () => {
    const staffedHours = defaultStaffedHours();
    staffedHours.mon = { open: true, start: '07:00', end: '19:00' };
    const parsed = parsePracticeSettings({ staffedHours, designatedIndividualUserId: 'user-1' });
    expect(parsed.staffedHours).toEqual(staffedHours);
    expect(parsed.designatedIndividualUserId).toBe('user-1');
  });

  it('ignores a stored schedule that is malformed instead of dispatching on it', () => {
    expect(parsePracticeSettings({ staffedHours: { mon: { open: true, start: 'late', end: 'later' } } }).staffedHours)
      .toBeUndefined();
  });

  it('accepts hours wider than the engine call window, since the engine window is a separate limit', () => {
    const wide = defaultStaffedHours();
    wide.mon = { open: true, start: '06:00', end: '21:00' };
    expect(validatePracticeSettingsUpdate({ staffedHours: wide })).toBeNull();
  });

  it('rejects an incomplete or backwards schedule with a staffedHours message', () => {
    const backwards = defaultStaffedHours();
    backwards.fri = { open: true, start: '17:00', end: '09:00' };
    expect(validatePracticeSettingsUpdate({ staffedHours: backwards })).toMatch(/staffedHours fri start must be before end/);
    expect(validatePracticeSettingsUpdate({ staffedHours: {} as never })).toMatch(/staffedHours/);
  });

  describe('updatePracticeSettings designated individual', () => {
    function prismaWith(userRow: { id: string } | null) {
      const update = vi.fn(async () => ({}));
      return {
        client: {
          user: { findFirst: vi.fn(async () => userRow) },
          practice: { findUnique: vi.fn(async () => ({ settings: {} })), update },
        } as unknown as PrismaClient,
        update,
      };
    }

    it('saves a designated individual who is an active user of this practice', async () => {
      const { client, update } = prismaWith({ id: 'user-1' });
      const saved = await updatePracticeSettings(client, 'practice-1', { designatedIndividualUserId: 'user-1' });
      expect(saved.designatedIndividualUserId).toBe('user-1');
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('refuses someone who is not an active user of this practice, and saves nothing', async () => {
      const { client, update } = prismaWith(null);
      await expect(
        updatePracticeSettings(client, 'practice-1', { designatedIndividualUserId: 'someone-else' }),
      ).rejects.toThrow(/designatedIndividualUserId must be an active user of this practice/);
      expect(update).not.toHaveBeenCalled();
    });

    it('scopes the lookup to this practice and to active users', async () => {
      const { client } = prismaWith({ id: 'user-1' });
      await updatePracticeSettings(client, 'practice-1', { designatedIndividualUserId: 'user-1' });
      const findFirst = (client.user.findFirst as unknown as ReturnType<typeof vi.fn>);
      expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'user-1', practiceId: 'practice-1', isActive: true });
    });
  });
});
