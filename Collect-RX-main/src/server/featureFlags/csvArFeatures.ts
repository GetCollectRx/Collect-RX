import type { PrismaClient } from '@prisma/client';
import { runWithRlsBypass } from '../db/rlsContext.js';

/** Staged CSV-first AR capabilities — per-practice feature flags. */
export const CSV_AR_FEATURES = {
  DENIAL_HUB: 'csv_ar.denial_hub',
  EOB_RECONCILIATION: 'csv_ar.eob_reconciliation',
  PREVISIT_CSV: 'csv_ar.previsit_csv',
  CARRIER_INTELLIGENCE: 'csv_ar.carrier_intelligence',
  AR_COMMAND_CENTER: 'csv_ar.ar_command_center',
  DSO_CONSOLE: 'csv_ar.dso_console',
  COMPLIANCE_WORKSPACE: 'csv_ar.compliance_workspace',
} as const;

export type CsvArFeature = (typeof CSV_AR_FEATURES)[keyof typeof CSV_AR_FEATURES];

export async function isCsvArFeatureEnabled(
  prisma: PrismaClient,
  practiceId: string,
  feature: CsvArFeature,
): Promise<boolean> {
  // Platform-wide rows (practice_id NULL) are invisible inside a practice's RLS
  // scope, so the lookup runs outside it. It reads one flag row, no tenant data.
  // A pause at either level wins; the feature is ON only when no row pauses it.
  const pausedRow = await runWithRlsBypass(() =>
    prisma.featureFlag.findFirst({
      where: {
        feature,
        paused: true,
        OR: [{ practiceId }, { practiceId: null }],
      },
      select: { id: true },
    }),
  );
  return pausedRow === null;
}

export async function setCsvArFeaturePaused(
  prisma: PrismaClient,
  practiceId: string | null,
  feature: CsvArFeature,
  paused: boolean,
  reason?: string,
): Promise<void> {
  const existing = await prisma.featureFlag.findFirst({
    where: { practiceId, feature },
    select: { id: true },
  });
  const data = {
    paused,
    pauseReason: reason ?? null,
    pausedAt: paused ? new Date() : null,
  };
  if (existing) {
    await prisma.featureFlag.update({ where: { id: existing.id }, data });
    return;
  }
  await prisma.featureFlag.create({
    data: { practiceId, feature, ...data },
  });
}
