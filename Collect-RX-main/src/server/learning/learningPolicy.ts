import type { PrismaClient } from '@prisma/client';

/**
 * Per-practice learning controls (policy research HP#14, PS#15; synthesis F12,
 * H12). Both flags default to false in the schema. A practice whose transcripts
 * feed cross-tenant learning must opt in (learningContribution), and a practice
 * that reads shared lessons must opt in (learningConsumption). Every learning
 * module reads these through this file so the rule lives in one place.
 */

export const LEARNING_CONTRIBUTION_DISABLED = 'LEARNING_CONTRIBUTION_DISABLED';
export const LEARNING_CONSUMPTION_DISABLED = 'LEARNING_CONSUMPTION_DISABLED';

export interface PracticeLearningPolicy {
  learningContribution: boolean;
  learningConsumption: boolean;
  /**
   * Identifiers that belong to the practice. Used to fingerprint lesson text
   * so that a lesson naming the contributing practice is rejected before it
   * can reach review. Values are normalized: lowercase, digits only for numbers.
   */
  fingerprintTerms: string[];
}

const DENIED: PracticeLearningPolicy = {
  learningContribution: false,
  learningConsumption: false,
  fingerprintTerms: [],
};

function normalizeTerm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** Fingerprint values shorter than this are too generic to match safely. */
const MIN_NAME_FINGERPRINT_LENGTH = 6;
const MIN_NUMBER_FINGERPRINT_DIGITS = 6;

export async function loadPracticeLearningPolicy(
  prisma: PrismaClient,
  practiceId: string,
): Promise<PracticeLearningPolicy> {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: {
      name: true,
      billingPhone: true,
      faxNumber: true,
      npi: true,
      taxId: true,
      learningContribution: true,
      learningConsumption: true,
    },
  });
  if (!practice) return DENIED;

  const fingerprintTerms: string[] = [];
  const name = normalizeTerm(practice.name);
  if (name.length >= MIN_NAME_FINGERPRINT_LENGTH) fingerprintTerms.push(name);
  for (const number of [practice.billingPhone, practice.faxNumber, practice.npi, practice.taxId]) {
    if (!number) continue;
    const digits = digitsOnly(number);
    if (digits.length >= MIN_NUMBER_FINGERPRINT_DIGITS) fingerprintTerms.push(digits);
  }

  return {
    learningContribution: practice.learningContribution,
    learningConsumption: practice.learningConsumption,
    fingerprintTerms,
  };
}

/** Practice ids whose transcripts may feed learning. Used as a query filter. */
export async function contributingPracticeIds(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.practice.findMany({
    where: { learningContribution: true },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
