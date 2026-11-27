import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { PatientPHI } from '../src/pii-vault.js';

import { extractLessonsFromCall, parseExtractedLessons } from '../src/server/learning/carrierLessons.js';
import { leaksKnownIdentifier } from '../src/server/learning/lessonIdentifierFilter.js';

const PHI: PatientPHI = {
  patientName: 'Jordan Mercer',
  dateOfBirth: '1915-03-02',
  subscriberId: 'SUB998877',
  groupPolicyNumber: 'GRP4421',
  subscriberName: 'Avery Mercer',
  subscriberDateOfBirth: '1948-11-30',
  healthCardNumber: '5550123456',
};

function modelReply(lessons: Array<Record<string, unknown>>): string {
  return JSON.stringify({ lessons });
}

const BENIGN = {
  category: 'IVR_NAVIGATION',
  observation: 'The claims menu accepts zero to reach a representative directly.',
  recommendation: 'Press 0 at the claims menu to reach a representative sooner.',
  confidence: 0.8,
};

describe('parseExtractedLessons: known-identifier gate', () => {
  it('drops a lesson that repeats the patient full name and keeps a benign lesson', () => {
    const lessons = parseExtractedLessons(
      modelReply([
        { ...BENIGN },
        { category: 'REP_INTERACTION', observation: 'Rep asked for Jordan Mercer first.', recommendation: 'Offer the name first.', confidence: 0.6 },
      ]),
      PHI,
    );
    expect(lessons).toHaveLength(1);
    expect(lessons[0].observation).toBe(BENIGN.observation);
  });

  it('drops a lesson that repeats only a surname token', () => {
    const lessons = parseExtractedLessons(
      modelReply([{ category: 'REP_INTERACTION', observation: 'Rep read back Mercer twice.', recommendation: 'Confirm the surname.', confidence: 0.5 }]),
      PHI,
    );
    expect(lessons).toEqual([]);
  });

  it('drops a lesson that repeats the subscriber name', () => {
    const lessons = parseExtractedLessons(
      modelReply([{ category: 'REP_INTERACTION', observation: 'Rep asked for Avery.', recommendation: 'Ask for the subscriber.', confidence: 0.5 }]),
      PHI,
    );
    expect(lessons).toEqual([]);
  });

  it('drops a lesson that writes the date of birth in a long form', () => {
    const lessons = parseExtractedLessons(
      modelReply([{ category: 'EXTRACTION', observation: 'Rep read back March 2, 1915 as the birth date.', recommendation: 'Confirm dates.', confidence: 0.5 }]),
      PHI,
    );
    expect(lessons).toEqual([]);
  });

  it('drops a lesson that repeats an identifier value', () => {
    const lessons = parseExtractedLessons(
      modelReply([{ category: 'REP_INTERACTION', observation: 'Rep asked for group GRP4421 before the claim.', recommendation: 'Lead with the group.', confidence: 0.5 }]),
      PHI,
    );
    expect(lessons).toEqual([]);
  });

  it('does not drop a lesson that only shares a substring of an identifier', () => {
    expect(leaksKnownIdentifier('The menu item GRP44219 is unrelated.', PHI)).toBe(false);
    expect(leaksKnownIdentifier('Jordanian holidays affect queues.', PHI)).toBe(false);
  });
});

describe('extractLessonsFromCall: fail closed without the call identifiers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends nothing to the model and stores nothing when no identifiers were resolved', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const prisma = {
      callAttempt: {
        findUnique: vi.fn().mockResolvedValue({
          transcriptText: 'x'.repeat(250),
          claim: { carrierId: 'canada_life' },
        }),
      },
      carrierLesson: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn(), create: vi.fn() },
    } as unknown as PrismaClient;

    const stored = await extractLessonsFromCall(prisma, 'attempt-1', null);

    expect(stored).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.carrierLesson.create).not.toHaveBeenCalled();
  });
});
