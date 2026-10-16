import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { appendPhiAccessEvent, appendRequiredAuditLog } from '../audit/auditLog.js';
import { scanLessonText, type LessonScanReasonCode } from '../learning/lessonTextScan.js';

/**
 * Breach register and custodian packet (policy research HP#2, HP#3, HP#4, PS#12,
 * PS#13; synthesis F5, H4, H5).
 *
 * The register records every breach, not only high-risk ones. Required fields
 * follow SOR/2018-64 s. 2(1)(a) to (g). The packet gives the custodian what it
 * needs to notify individuals. CollectRx does not notify patients itself.
 *
 * Free-text fields pass the identifier scan at write time, and the scan
 * rejection returns a reason code without the text. Packets are built from an
 * explicit allowlist of keys, so no other column can reach a custodian.
 */

export const BREACH_CATEGORIES = [
  'LOSS',
  'THEFT',
  'UNAUTHORIZED_ACCESS',
  'UNAUTHORIZED_USE',
  'UNAUTHORIZED_DISCLOSURE',
  'OTHER',
] as const;
export type BreachCategory = (typeof BREACH_CATEGORIES)[number];

export const BREACH_PROVINCES = ['ON', 'AB', 'BC', 'QC', 'OTHER'] as const;
export type BreachProvince = (typeof BREACH_PROVINCES)[number];

/** Minimum record period, SOR/2018-64 s. 6 (24 months from the time of the breach). */
export const BREACH_RECORD_MIN_MONTHS = 24;

/** Packet keys. Changing this list is a reviewed change, because it defines what a custodian receives. */
export const BREACH_PACKET_KEYS = [
  'packetVersion',
  'entryId',
  'category',
  'province',
  'circumstances',
  'periodStart',
  'periodEnd',
  'dataElements',
  'individualsCount',
  'affectedTokens',
  'stepsToReduceHarm',
  'notificationSteps',
  'contactRole',
  'vendorsInvolved',
  'rrosHAssessment',
  'realRiskOfSignificantHarm',
  'timeline',
  'generatedAt',
] as const;

const MAX_FREE_TEXT = 4000;
const MAX_CONTACT_ROLE = 200;
const MAX_TOKENS = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BreachRegisterErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_FIELD'
  | 'FREE_TEXT_IDENTIFIER'
  | 'NOT_FOUND';

export class BreachRegisterError extends Error {
  constructor(
    readonly code: BreachRegisterErrorCode,
    message: string,
    readonly field?: string,
    readonly reasonCode?: LessonScanReasonCode,
  ) {
    super(message);
    this.name = 'BreachRegisterError';
  }
}

export interface BreachFields {
  category: BreachCategory;
  province: BreachProvince;
  circumstances: string;
  periodStart: Date;
  periodEnd: Date | null;
  discoveredAt: Date;
  dataElements: string;
  individualsCount: number;
  affectedTokens: string[];
  stepsToReduceHarm: string;
  notificationSteps: string;
  contactRole: string;
  vendorsInvolved: string | null;
  rrosHAssessment: string | null;
  realRiskOfSignificantHarm: boolean | null;
  custodianNotifiedAt: Date | null;
  regulatorNotifiedAt: Date | null;
  closedAt: Date | null;
}

const FIELD_NAMES: ReadonlyArray<keyof BreachFields> = [
  'category',
  'province',
  'circumstances',
  'periodStart',
  'periodEnd',
  'discoveredAt',
  'dataElements',
  'individualsCount',
  'affectedTokens',
  'stepsToReduceHarm',
  'notificationSteps',
  'contactRole',
  'vendorsInvolved',
  'rrosHAssessment',
  'realRiskOfSignificantHarm',
  'custodianNotifiedAt',
  'regulatorNotifiedAt',
  'closedAt',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(raw: Record<string, unknown>, field: string, max: number): string {
  const value = raw[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BreachRegisterError('MISSING_FIELD', `${field} is required`, field);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new BreachRegisterError('INVALID_FIELD', `${field} exceeds ${max} characters`, field);
  }
  return trimmed;
}

function optionalText(raw: Record<string, unknown>, field: string, max: number): string | null {
  const value = raw[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new BreachRegisterError('INVALID_FIELD', `${field} must be text`, field);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new BreachRegisterError('INVALID_FIELD', `${field} exceeds ${max} characters`, field);
  }
  return trimmed;
}

function parseDate(raw: unknown, field: string, required: boolean): Date | null {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new BreachRegisterError('MISSING_FIELD', `${field} is required`, field);
    return null;
  }
  const date = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(date.getTime())) {
    throw new BreachRegisterError('INVALID_FIELD', `${field} is not a valid date`, field);
  }
  return date;
}

function assertFreeTextClean(field: string, text: string | null): void {
  if (text === null) return;
  const scan = scanLessonText(text, []);
  if (!scan.ok) {
    throw new BreachRegisterError(
      'FREE_TEXT_IDENTIFIER',
      `${field} appears to contain an identifier (${scan.reasonCode}). Remove names, numbers and contact details.`,
      field,
      scan.reasonCode,
    );
  }
}

/** Validates an untrusted body into typed breach fields. Throws before any write. */
export function parseBreachFields(raw: unknown): BreachFields {
  if (!isRecord(raw)) throw new BreachRegisterError('INVALID_FIELD', 'body must be an object');

  const category = requiredText(raw, 'category', 40);
  if (!(BREACH_CATEGORIES as readonly string[]).includes(category)) {
    throw new BreachRegisterError('INVALID_FIELD', 'category is not recognised', 'category');
  }
  const province = requiredText(raw, 'province', 10);
  if (!(BREACH_PROVINCES as readonly string[]).includes(province)) {
    throw new BreachRegisterError('INVALID_FIELD', 'province is not recognised', 'province');
  }

  const circumstances = requiredText(raw, 'circumstances', MAX_FREE_TEXT);
  const dataElements = requiredText(raw, 'dataElements', MAX_FREE_TEXT);
  const stepsToReduceHarm = requiredText(raw, 'stepsToReduceHarm', MAX_FREE_TEXT);
  const notificationSteps = requiredText(raw, 'notificationSteps', MAX_FREE_TEXT);
  const contactRole = requiredText(raw, 'contactRole', MAX_CONTACT_ROLE);
  const vendorsInvolved = optionalText(raw, 'vendorsInvolved', MAX_FREE_TEXT);
  const rrosHAssessment = optionalText(raw, 'rrosHAssessment', MAX_FREE_TEXT);

  assertFreeTextClean('circumstances', circumstances);
  assertFreeTextClean('dataElements', dataElements);
  assertFreeTextClean('stepsToReduceHarm', stepsToReduceHarm);
  assertFreeTextClean('notificationSteps', notificationSteps);
  assertFreeTextClean('contactRole', contactRole);
  assertFreeTextClean('vendorsInvolved', vendorsInvolved);
  assertFreeTextClean('rrosHAssessment', rrosHAssessment);

  const periodStart = parseDate(raw.periodStart, 'periodStart', true) as Date;
  const periodEnd = parseDate(raw.periodEnd, 'periodEnd', false);
  if (periodEnd && periodEnd.getTime() < periodStart.getTime()) {
    throw new BreachRegisterError('INVALID_FIELD', 'periodEnd is before periodStart', 'periodEnd');
  }
  const discoveredAt = parseDate(raw.discoveredAt, 'discoveredAt', true) as Date;

  const count = raw.individualsCount;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new BreachRegisterError('INVALID_FIELD', 'individualsCount must be a non-negative integer', 'individualsCount');
  }

  const tokens = raw.affectedTokens ?? [];
  if (!Array.isArray(tokens) || tokens.length > MAX_TOKENS) {
    throw new BreachRegisterError('INVALID_FIELD', 'affectedTokens must be a list', 'affectedTokens');
  }
  const affectedTokens = tokens.map((token) => {
    if (typeof token !== 'string' || !UUID.test(token)) {
      throw new BreachRegisterError('INVALID_FIELD', 'affectedTokens must contain patient token UUIDs only', 'affectedTokens');
    }
    return token.toLowerCase();
  });

  let realRiskOfSignificantHarm: boolean | null = null;
  if (raw.realRiskOfSignificantHarm !== undefined && raw.realRiskOfSignificantHarm !== null) {
    if (typeof raw.realRiskOfSignificantHarm !== 'boolean') {
      throw new BreachRegisterError('INVALID_FIELD', 'realRiskOfSignificantHarm must be true or false', 'realRiskOfSignificantHarm');
    }
    realRiskOfSignificantHarm = raw.realRiskOfSignificantHarm;
  }

  return {
    category: category as BreachCategory,
    province: province as BreachProvince,
    circumstances,
    periodStart,
    periodEnd,
    discoveredAt,
    dataElements,
    individualsCount: count,
    affectedTokens,
    stepsToReduceHarm,
    notificationSteps,
    contactRole,
    vendorsInvolved,
    rrosHAssessment,
    realRiskOfSignificantHarm,
    custodianNotifiedAt: parseDate(raw.custodianNotifiedAt, 'custodianNotifiedAt', false),
    regulatorNotifiedAt: parseDate(raw.regulatorNotifiedAt, 'regulatorNotifiedAt', false),
    closedAt: parseDate(raw.closedAt, 'closedAt', false),
  };
}

/** Retention floor: at least 24 months after recording, or after closure if later. */
export function computeBreachRetainUntil(recordedAt: Date, closedAt: Date | null): Date {
  const anchor = closedAt && closedAt.getTime() > recordedAt.getTime() ? closedAt : recordedAt;
  const retainUntil = new Date(anchor.getTime());
  retainUntil.setUTCMonth(retainUntil.getUTCMonth() + BREACH_RECORD_MIN_MONTHS);
  return retainUntil;
}

interface StoredBreachRow extends BreachFields {
  id: string;
  practiceId: string;
  recordedAt: Date;
  retainUntil: Date;
}

export async function createBreachEntry(
  prisma: PrismaClient,
  input: { practiceId: string; body: unknown; userId?: string; req?: Request },
): Promise<{ id: string; retainUntil: Date }> {
  const fields = parseBreachFields(input.body);
  const recordedAt = new Date();
  const retainUntil = computeBreachRetainUntil(recordedAt, fields.closedAt);
  const created = await prisma.breachRegisterEntry.create({
    data: { ...fields, practiceId: input.practiceId, retainUntil, recordedAt },
    select: { id: true, retainUntil: true },
  });
  await appendRequiredAuditLog(prisma, {
    practiceId: input.practiceId,
    userId: input.userId,
    action: 'breach_register.created',
    subjectType: 'breach_register_entry',
    subjectId: created.id,
    details: {
      category: fields.category,
      province: fields.province,
      individualsCount: fields.individualsCount,
      closed: fields.closedAt !== null,
    },
    req: input.req,
  });
  return created;
}

export async function updateBreachEntry(
  prisma: PrismaClient,
  input: { practiceId: string; id: string; patch: unknown; userId?: string; req?: Request },
): Promise<void> {
  const existing = await prisma.breachRegisterEntry.findFirst({
    where: { id: input.id, practiceId: input.practiceId },
  });
  if (!existing) throw new BreachRegisterError('NOT_FOUND', 'Breach entry not found');

  const current = existing as unknown as StoredBreachRow;
  const merged: Record<string, unknown> = {
    category: current.category,
    province: current.province,
    circumstances: current.circumstances,
    periodStart: current.periodStart,
    periodEnd: current.periodEnd,
    discoveredAt: current.discoveredAt,
    dataElements: current.dataElements,
    individualsCount: current.individualsCount,
    affectedTokens: current.affectedTokens,
    stepsToReduceHarm: current.stepsToReduceHarm,
    notificationSteps: current.notificationSteps,
    contactRole: current.contactRole,
    vendorsInvolved: current.vendorsInvolved,
    rrosHAssessment: current.rrosHAssessment,
    realRiskOfSignificantHarm: current.realRiskOfSignificantHarm,
    custodianNotifiedAt: current.custodianNotifiedAt,
    regulatorNotifiedAt: current.regulatorNotifiedAt,
    closedAt: current.closedAt,
  };
  const patch = isRecord(input.patch) ? input.patch : {};
  const changedFields = FIELD_NAMES.filter((name) => name in patch).map(String);
  for (const name of changedFields) merged[name] = patch[name];

  const fields = parseBreachFields(merged);
  const retainUntil = computeBreachRetainUntil(current.recordedAt, fields.closedAt);
  await prisma.breachRegisterEntry.update({
    where: { id: input.id },
    data: { ...fields, retainUntil },
  });
  await appendRequiredAuditLog(prisma, {
    practiceId: input.practiceId,
    userId: input.userId,
    action: 'breach_register.updated',
    subjectType: 'breach_register_entry',
    subjectId: input.id,
    details: { changedFields },
    req: input.req,
  });
}

/** List view. Patient tokens are reduced to a count; the full list is only in the packet. */
export async function listBreachEntries(prisma: PrismaClient, practiceId: string) {
  const rows = await prisma.breachRegisterEntry.findMany({
    where: { practiceId },
    orderBy: { discoveredAt: 'desc' },
    take: 200,
  });
  return rows.map(({ affectedTokens, ...rest }) => ({ ...rest, affectedTokenCount: affectedTokens.length }));
}

export async function buildBreachPacket(
  prisma: PrismaClient,
  input: { practiceId: string; id: string; userId?: string; req?: Request },
): Promise<Record<(typeof BREACH_PACKET_KEYS)[number], unknown>> {
  const row = (await prisma.breachRegisterEntry.findFirst({
    where: { id: input.id, practiceId: input.practiceId },
  })) as unknown as StoredBreachRow | null;
  if (!row) throw new BreachRegisterError('NOT_FOUND', 'Breach entry not found');

  const timeline = [
    { event: 'discovered', at: row.discoveredAt },
    { event: 'custodian_notified', at: row.custodianNotifiedAt },
    { event: 'regulator_notified', at: row.regulatorNotifiedAt },
    { event: 'closed', at: row.closedAt },
  ].filter((step): step is { event: string; at: Date } => step.at !== null);

  const packet: Record<(typeof BREACH_PACKET_KEYS)[number], unknown> = {
    packetVersion: 1,
    entryId: row.id,
    category: row.category,
    province: row.province,
    circumstances: row.circumstances,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    dataElements: row.dataElements,
    individualsCount: row.individualsCount,
    affectedTokens: row.affectedTokens,
    stepsToReduceHarm: row.stepsToReduceHarm,
    notificationSteps: row.notificationSteps,
    contactRole: row.contactRole,
    vendorsInvolved: row.vendorsInvolved,
    rrosHAssessment: row.rrosHAssessment,
    realRiskOfSignificantHarm: row.realRiskOfSignificantHarm,
    timeline,
    generatedAt: new Date(),
  };

  await appendPhiAccessEvent(prisma, {
    practiceId: input.practiceId,
    operation: 'breach_packet_generate',
    recordType: 'breach_register_entry',
    recordId: row.id,
    purpose: 'custodian breach notification',
    actorId: input.userId,
    required: true,
  });
  await appendRequiredAuditLog(prisma, {
    practiceId: input.practiceId,
    userId: input.userId,
    action: 'breach_register.packet_generated',
    subjectType: 'breach_register_entry',
    subjectId: row.id,
    details: { tokenCount: row.affectedTokens.length },
    req: input.req,
  });
  return packet;
}

/** Counts per O. Reg. 329/04 s. 6.4 categories. Unmapped categories are reported separately. */
export const ANNUAL_COUNT_MAPPING: Record<BreachCategory, 'loss' | 'theft' | 'unauthorized_use' | 'unauthorized_disclosure' | null> = {
  LOSS: 'loss',
  THEFT: 'theft',
  UNAUTHORIZED_USE: 'unauthorized_use',
  UNAUTHORIZED_DISCLOSURE: 'unauthorized_disclosure',
  UNAUTHORIZED_ACCESS: null,
  OTHER: null,
};

export async function annualBreachCounts(prisma: PrismaClient, practiceId: string, year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BreachRegisterError('INVALID_FIELD', 'year must be between 2000 and 2100', 'year');
  }
  const rows = await prisma.breachRegisterEntry.findMany({
    where: {
      practiceId,
      discoveredAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
    },
    select: { category: true },
  });
  const counts = { loss: 0, theft: 0, unauthorized_use: 0, unauthorized_disclosure: 0 };
  let unclassified = 0;
  for (const row of rows) {
    const mapped = ANNUAL_COUNT_MAPPING[row.category as BreachCategory] ?? null;
    if (mapped) counts[mapped] += 1;
    else unclassified += 1;
  }
  return {
    year,
    counts,
    unclassified,
    total: rows.length,
    mappingStatus: 'PENDING_COUNSEL: category mapping to O. Reg. 329/04 s. 6.4 not yet confirmed',
  };
}
