import type { PrismaClient } from '@prisma/client';
import type { PracticePmsInfo, PmsIngestMode, PmsVendorId } from '../../types/pms.js';
import { PHONE_DECISION_PROFILE } from '../../types/pms.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';
import {
  getPmsImportFamily,
  normalizePmsVendorId,
  vendorDisplayName,
} from './pmsRegistry.js';

/** When unset and no import history — generic CSV mapping, same phone logic as every PMS. */
const DEFAULT_VENDOR: PmsVendorId = 'other';

export interface ResolvedPmsImport {
  vendorId: PmsVendorId;
  importFamily: ReturnType<typeof getPmsImportFamily>;
}

/**
 * Resolve which PMS vendor and import mapper to use for an ingest request.
 * Explicit slug wins; else practice settings; else latest import run; else AbelDent (legacy default).
 */
export async function resolvePmsImport(
  prisma: PrismaClient,
  practiceId: string,
  explicitVendor?: string | null,
): Promise<ResolvedPmsImport> {
  const fromParam = normalizePmsVendorId(explicitVendor ?? undefined);
  if (fromParam) {
    return { vendorId: fromParam, importFamily: getPmsImportFamily(fromParam) };
  }

  const ctx = await getPracticePmsContext(prisma, practiceId);
  return { vendorId: ctx.vendorId, importFamily: ctx.importFamily };
}

export async function getPracticePmsContext(
  prisma: PrismaClient,
  practiceId: string,
): Promise<PracticePmsInfo> {
  const settings = await getPracticeSettings(prisma, practiceId);
  let inferredFromLastImport = false;
  let vendorId = settings.pmsVendor ?? null;

  if (!vendorId) {
    const lastRun = await prisma.pmsImportRun.findFirst({
      where: { practiceId },
      orderBy: { startedAt: 'desc' },
      select: { pmsSource: true },
    });
    vendorId = normalizePmsVendorId(lastRun?.pmsSource) ?? DEFAULT_VENDOR;
    inferredFromLastImport = !settings.pmsVendor && !!lastRun;
  }

  const ingestMode: PmsIngestMode =
    settings.pmsIngestMode ??
    (vendorId === 'abeldent' ? 'desktop_connector' : 'csv');

  return {
    vendorId,
    displayName: vendorDisplayName(vendorId),
    importFamily: getPmsImportFamily(vendorId),
    ingestMode,
    phoneDecisionProfile: PHONE_DECISION_PROFILE,
    inferredFromLastImport,
  };
}

/** Persist detected vendor after a successful import when not yet configured. */
export async function ensurePracticePmsVendor(
  prisma: PrismaClient,
  practiceId: string,
  vendorId: PmsVendorId,
): Promise<void> {
  const settings = await getPracticeSettings(prisma, practiceId);
  if (settings.pmsVendor) return;

  const merged = { ...settings, pmsVendor: vendorId };
  await prisma.practice.update({
    where: { id: practiceId },
    data: { settings: merged as object },
  });
}
