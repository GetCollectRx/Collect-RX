import type { PrismaClient } from '@prisma/client';

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
  const flag = await prisma.featureFlag.findFirst({
    where: {
      feature,
      OR: [{ practiceId }, { practiceId: null }],
    },
    orderBy: { practiceId: 'desc' },
  });
  // Default ON when no flag row exists — staged rollout uses explicit pause rows.
  if (!flag) return true;
  return !flag.paused;
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
