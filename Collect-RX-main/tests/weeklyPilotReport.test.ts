import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  buildWeeklyPracticeMetrics,
  renderWeeklyReportEmail,
  sendWeeklyPilotReports,
  weeklyPilotReportEnabled,
} from '../src/server/reports/weeklyPilotReport';

const { mockSend, mockSetApiKey } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue([{ statusCode: 202 }]),
  mockSetApiKey: vi.fn(),
}));

vi.mock('@sendgrid/mail', () => ({
  default: { send: mockSend, setApiKey: mockSetApiKey },
}));

const NOW = new Date('2026-07-13T11:00:00Z');

function makePrisma(overrides: {
  attempts?: Array<{ outcome: string | null; durationSeconds: number | null; claim: { billedAmount: number } }>;
  ownerEmail?: string | null;
} = {}) {
  const attempts = overrides.attempts ?? [
    { outcome: 'RESOLVED', durationSeconds: 300, claim: { billedAmount: 850.5 } },
    { outcome: 'RESOLVED', durationSeconds: 240, claim: { billedAmount: 425 } },
    { outcome: 'NO_ANSWER', durationSeconds: 60, claim: { billedAmount: 900 } },
  ];
  return {
    practice: {
      findMany: async () => [{ id: 'practice-1' }],
      findUnique: async () => ({ id: 'practice-1', name: 'Test Dental Practice' }),
    },
    callAttempt: {
      findMany: async () => attempts,
    },
    user: {
      findFirst: async () =>
        overrides.ownerEmail === null ? null : { email: overrides.ownerEmail ?? 'owner@example-practice.local' },
    },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  mockSend.mockClear();
  mockSetApiKey.mockClear();
  vi.stubEnv('SENDGRID_API_KEY', 'test_sendgrid_key');
  vi.stubEnv('SENDGRID_FROM_EMAIL', 'reports@collectrx-test.local');
  vi.stubEnv('WEEKLY_PILOT_REPORT_ENABLED', 'true');
});

describe('weeklyPilotReportEnabled', () => {
  it('is off unless the env flag is set', () => {
    vi.stubEnv('WEEKLY_PILOT_REPORT_ENABLED', '');
    expect(weeklyPilotReportEnabled()).toBe(false);
    vi.stubEnv('WEEKLY_PILOT_REPORT_ENABLED', 'true');
    expect(weeklyPilotReportEnabled()).toBe(true);
  });
});

describe('buildWeeklyPracticeMetrics', () => {
  it('aggregates calls, resolutions, revenue, and minutes over a 7-day window', async () => {
    const metrics = await buildWeeklyPracticeMetrics(makePrisma(), 'practice-1', NOW);

    expect(metrics.practiceName).toBe('Test Dental Practice');
    expect(metrics.windowDays).toBe(7);
    expect(metrics.callsPlaced).toBe(3);
    expect(metrics.claimsResolved).toBe(2);
    expect(metrics.revenueRecovered).toBeCloseTo(1275.5);
    expect(metrics.callMinutes).toBe(10);
  });
});

describe('renderWeeklyReportEmail', () => {
  it('renders subject, html, and text with the practice metrics', async () => {
    const metrics = await buildWeeklyPracticeMetrics(makePrisma(), 'practice-1', NOW);
    const email = renderWeeklyReportEmail(metrics);

    expect(email.subject).toContain('Test Dental Practice');
    expect(email.html).toContain('Carrier calls placed');
    expect(email.html).toContain('$1,275.50');
    expect(email.text).toContain('Claims resolved: 2');
    expect(email.text).toContain('Staff phone time saved: 10 minutes');
  });
});

describe('sendWeeklyPilotReports', () => {
  it('sends the rendered report to the practice owner email', async () => {
    const result = await sendWeeklyPilotReports(makePrisma(), NOW);

    expect(result).toEqual({ sent: 1, skippedNoOwner: 0, failed: 0 });
    expect(mockSetApiKey).toHaveBeenCalledWith('test_sendgrid_key');
    expect(mockSend).toHaveBeenCalledTimes(1);

    const msg = mockSend.mock.calls[0]?.[0];
    expect(msg?.to).toBe('owner@example-practice.local');
    expect(msg?.subject).toContain('Test Dental Practice');
    expect(msg?.html).toContain('$1,275.50');
  });

  it('skips practices with no active owner user', async () => {
    const result = await sendWeeklyPilotReports(makePrisma({ ownerEmail: null }), NOW);

    expect(result).toEqual({ sent: 0, skippedNoOwner: 1, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does nothing when SendGrid credentials are missing', async () => {
    vi.stubEnv('SENDGRID_API_KEY', '');
    const result = await sendWeeklyPilotReports(makePrisma(), NOW);

    expect(result).toEqual({ sent: 0, skippedNoOwner: 0, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('counts a per-practice send failure without throwing', async () => {
    mockSend.mockRejectedValueOnce(new Error('sendgrid unavailable'));
    const result = await sendWeeklyPilotReports(makePrisma(), NOW);

    expect(result).toEqual({ sent: 0, skippedNoOwner: 0, failed: 1 });
  });
});
