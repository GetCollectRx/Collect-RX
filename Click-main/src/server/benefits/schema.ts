/**
 * CollectRx — Benefits Data Layer
 *
 * All DB operations for patient_benefits, benefit_coverage, plan_years.
 * PHI constraint: patient_token is a UUID; no names or DOBs stored here.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// CDT code → category mapping
export const CDT_CATEGORIES: Record<string, { codes: RegExp; label: string }> = {
  preventive:        { codes: /^D0[1-4]\d{2}|D1\d{3}$/, label: 'Preventive' },
  basic_restorative: { codes: /^D2[0-3]\d{2}$/, label: 'Basic Restorative' },
  major_restorative: { codes: /^D2[4-9]\d{2}$/, label: 'Major Restorative' },
  endodontics:       { codes: /^D3\d{3}$/, label: 'Endodontics' },
  periodontics:      { codes: /^D4\d{3}$/, label: 'Periodontics' },
  prosthodontics:    { codes: /^D5[0-8]\d{2}|D6[2-9]\d{2}$/, label: 'Prosthodontics' },
  oral_surgery:      { codes: /^D7\d{3}$/, label: 'Oral Surgery' },
  orthodontics:      { codes: /^D8\d{3}$/, label: 'Orthodontics' },
};

export function cdtToCategory(cdtCode: string): string {
  const code = String(cdtCode).toUpperCase();
  for (const [category, { codes }] of Object.entries(CDT_CATEGORIES)) {
    if (codes.test(code)) return category;
  }
  return 'other';
}

// Types
export interface BenefitsData {
  patientToken: string;
  carrierCode: string;
  planYear: string;
  annualMax?: number | null;
  annualMaxUsed?: number | null;
  deductible?: number | null;
  deductibleMet?: number | null;
}

export interface CoverageData {
  patientToken: string;
  carrierCode: string;
  cdtCategory: string;
  coveragePct: number;
  waitingPeriodMonths?: number | null;
  waitingPeriodStart?: Date | string | null;
  frequencyLimitMonths?: number | null;
  lastServiceDate?: Date | string | null;
}

// Patient Benefits CRUD
export async function getBenefits(patientToken: string, carrierCode: string, planYear: string) {
  return prisma.patientBenefits.findUnique({
    where: {
      patientToken_carrierCode_planYear: {
        patientToken,
        carrierCode,
        planYear,
      },
    },
  });
}

export async function getCurrentBenefits(patientToken: string, carrierCode: string) {
  const today = new Date();
  const planYear = await prisma.planYear.findFirst({
    where: {
      patientToken,
      carrierCode,
      planYearStart: { lte: today },
      planYearEnd: { gte: today },
    },
    orderBy: { planYearStart: 'desc' },
  });

  if (!planYear) return null;

  const yearLabel = planYear.planYearStart.getFullYear().toString();
  return getBenefits(patientToken, carrierCode, yearLabel);
}

export async function upsertBenefits(data: BenefitsData) {
  const { patientToken, carrierCode, planYear, annualMax, annualMaxUsed, deductible, deductibleMet } = data;

  return prisma.patientBenefits.upsert({
    where: {
      patientToken_carrierCode_planYear: {
        patientToken,
        carrierCode,
        planYear,
      },
    },
    update: {
      annualMax: annualMax ?? undefined,
      annualMaxUsed: annualMaxUsed ?? 0,
      deductible: deductible ?? 0,
      deductibleMet: deductibleMet ?? 0,
      lastVerifiedAt: new Date(),
      staleFlag: false,
      updatedAt: new Date(),
    },
    create: {
      patientToken,
      carrierCode,
      planYear,
      annualMax,
      annualMaxUsed: annualMaxUsed ?? 0,
      deductible: deductible ?? 0,
      deductibleMet: deductibleMet ?? 0,
      lastVerifiedAt: new Date(),
    },
  });
}

export async function addUsedAmount(patientToken: string, carrierCode: string, planYear: string, amount: number) {
  return prisma.patientBenefits.update({
    where: {
      patientToken_carrierCode_planYear: {
        patientToken,
        carrierCode,
        planYear,
      },
    },
    data: {
      annualMaxUsed: { increment: amount },
      updatedAt: new Date(),
    },
  });
}

export async function markStale(patientToken: string, carrierCode: string) {
  return prisma.patientBenefits.updateMany({
    where: { patientToken, carrierCode },
    data: { staleFlag: true, updatedAt: new Date() },
  });
}

// Benefit Coverage CRUD
export async function getCoverage(patientToken: string, carrierCode: string) {
  return prisma.benefitCoverage.findMany({
    where: { patientToken, carrierCode },
    orderBy: { cdtCategory: 'asc' },
  });
}

export async function getCoverageForCategory(patientToken: string, carrierCode: string, category: string) {
  return prisma.benefitCoverage.findUnique({
    where: {
      patientToken_carrierCode_cdtCategory: {
        patientToken,
        carrierCode,
        cdtCategory: category,
      },
    },
  });
}

export async function upsertCoverage(data: CoverageData) {
  const {
    patientToken, carrierCode, cdtCategory, coveragePct,
    waitingPeriodMonths, waitingPeriodStart, frequencyLimitMonths, lastServiceDate
  } = data;

  return prisma.benefitCoverage.upsert({
    where: {
      patientToken_carrierCode_cdtCategory: {
        patientToken,
        carrierCode,
        cdtCategory,
      },
    },
    update: {
      coveragePct,
      waitingPeriodMonths: waitingPeriodMonths ?? 0,
      waitingPeriodStart: waitingPeriodStart ? new Date(waitingPeriodStart) : null,
      frequencyLimitMonths: frequencyLimitMonths ?? null,
      lastServiceDate: lastServiceDate ? new Date(lastServiceDate) : null,
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    },
    create: {
      patientToken,
      carrierCode,
      cdtCategory,
      coveragePct,
      waitingPeriodMonths: waitingPeriodMonths ?? 0,
      waitingPeriodStart: waitingPeriodStart ? new Date(waitingPeriodStart) : null,
      frequencyLimitMonths: frequencyLimitMonths ?? null,
      lastServiceDate: lastServiceDate ? new Date(lastServiceDate) : null,
      lastVerifiedAt: new Date(),
    },
  });
}

export async function updateLastServiceDate(patientToken: string, carrierCode: string, cdtCategory: string, date: Date) {
  return prisma.benefitCoverage.update({
    where: {
      patientToken_carrierCode_cdtCategory: {
        patientToken,
        carrierCode,
        cdtCategory,
      },
    },
    data: {
      lastServiceDate: date,
      updatedAt: new Date(),
    },
  });
}

// Plan Years CRUD
export async function getPlanYear(patientToken: string, carrierCode: string) {
  const today = new Date();
  return prisma.planYear.findFirst({
    where: {
      patientToken,
      carrierCode,
      planYearStart: { lte: today },
      planYearEnd: { gte: today },
    },
  });
}

export async function upsertPlanYear(patientToken: string, carrierCode: string, startDate: Date | string, endDate: Date | string) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  return prisma.planYear.upsert({
    where: {
      patientToken_carrierCode_planYearStart: {
        patientToken,
        carrierCode,
        planYearStart: start,
      },
    },
    update: { planYearEnd: end },
    create: {
      patientToken,
      carrierCode,
      planYearStart: start,
      planYearEnd: end,
    },
  });
}

// Pending claims for annual max calculation
export async function getPendingClaimsTotal(patientToken: string, carrierCode: string, planYearStart: Date, planYearEnd: Date) {
  const balances = await prisma.patientBalance.findMany({
    where: {
      patientToken,
      carrierCode,
      treatmentDate: {
        gte: planYearStart,
        lte: planYearEnd,
      },
    },
  });

  let paid = 0;
  let pending = 0;

  for (const b of balances) {
    paid += Number(b.insurancePaid) || 0;
    if (b.paymentStatus === 'outstanding') {
      pending += Number(b.patientOwes) || 0;
    }
  }

  return { paid, pending };
}
