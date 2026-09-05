import type { PrismaClient } from '@prisma/client';

/**
 * Enforces the 1:1 treating-dentist-to-claim rule: every claim must resolve
 * to exactly one active, registered dentist on the submitting practice's
 * roster, identified by their unique CDA provider number. Never grouped
 * under the practice alone — insurers profile dentists by provider number,
 * and aggregating multiple dentists' work under one identity is an audit
 * flag, not just a data-quality issue.
 *
 * This is a plain validation function, not Express middleware: claims in
 * this codebase are created by src/server/pms/prismaClaimImporter.ts (CSV /
 * PMS import), which processes rows in a loop and pushes failures into a
 * per-row error list — there is no Express route that accepts a raw claim
 * payload with treatingDentistId + lineItems for middleware to intercept.
 * Call this from upsertInsuranceClaim() (or wherever a new claim row's
 * treatingDentistId is about to be set) before create/update, and route a
 * failure into the same result.errors array the importer already uses for
 * unrecognized carriers.
 */
export interface TreatingDentistValidationResult {
  ok: boolean;
  dentistId?: string;
  error?: string;
}

export async function validateTreatingDentistForClaim(
  prisma: PrismaClient,
  practiceId: string,
  providerNumber: string | null | undefined,
): Promise<TreatingDentistValidationResult> {
  const trimmed = providerNumber?.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Missing treating dentist provider number. A 1:1 practitioner identifier is mandatory for every claim.',
    };
  }

  const dentist = await prisma.dentist.findUnique({
    where: { providerNumber: trimmed },
    select: { id: true, practiceId: true, active: true },
  });

  if (!dentist || dentist.practiceId !== practiceId) {
    return {
      ok: false,
      error: `No dentist with provider number "${trimmed}" is registered on this practice's roster.`,
    };
  }

  if (!dentist.active) {
    return {
      ok: false,
      error: `Dentist with provider number "${trimmed}" is not active on this practice's roster.`,
    };
  }

  return { ok: true, dentistId: dentist.id };
}
