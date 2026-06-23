import { describe, expect, it } from 'vitest';
import {
  defaultPracticeSettings,
  parsePracticeSettings,
  validatePracticeSettingsUpdate,
} from '../src/server/services/practiceSettingsService.js';

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
