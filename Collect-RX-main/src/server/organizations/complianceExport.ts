/**
 * Auditor-facing org compliance export (Phase 4 FR-10/13,
 * specs/phase-4-enterprise-it-compliance.md). CSV per category, zipped —
 * directly attachable to a SOC 2 / PIPEDA auditor's workpapers, not a JSON
 * summary designed for our own dashboards.
 *
 * Zero PHI by construction: only ever selects from AuditLog, PhiAccessEvent,
 * OrganizationMember/User, CarrierBlockEvent, and OrgSsoEvent — none of which
 * store PHI values today.
 */
import { createHash } from 'node:crypto';
import { ZipArchive } from 'archiver';
import type { PrismaClient } from '@prisma/client';
import { runWithPracticeRls } from '../db/rlsContext.js';

export type OrgComplianceExportResult = {
  buffer: Buffer;
  checksum: string;
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map(csvEscape).join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c])).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}

async function zipCsvFiles(files: Array<{ name: string; content: string }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const f of files) archive.append(f.content, { name: f.name });
    void archive.finalize();
  });
}

export async function buildOrgComplianceExportZip(
  prisma: PrismaClient,
  organizationId: string,
  from: Date,
  to: Date,
): Promise<OrgComplianceExportResult> {
  const practiceIds = (
    await prisma.organizationPractice.findMany({ where: { organizationId }, select: { practiceId: true } })
  ).map((p) => p.practiceId);

  const perPractice = await Promise.all(
    practiceIds.map((practiceId) =>
      runWithPracticeRls(practiceId, () =>
        Promise.all([
          prisma.auditLog.findMany({
            where: { practiceId, createdAt: { gte: from, lte: to } },
            select: {
              id: true, createdAt: true, practiceId: true, userId: true,
              action: true, subjectType: true, subjectId: true, requestIp: true,
            },
            orderBy: { createdAt: 'asc' },
          }),
          prisma.phiAccessEvent.findMany({
            where: { practiceId, createdAt: { gte: from, lte: to } },
            select: {
              id: true, createdAt: true, practiceId: true, actorId: true,
              operation: true, recordType: true, recordId: true, purpose: true,
            },
            orderBy: { createdAt: 'asc' },
          }),
          prisma.carrierBlockEvent.findMany({
            where: { practiceId, blockedAt: { gte: from, lte: to } },
            select: {
              id: true, practiceId: true, carrierId: true, blockedAt: true,
              resumedAt: true, resumedBy: true, notes: true,
            },
            orderBy: { blockedAt: 'asc' },
          }),
        ]),
      ),
    ),
  );

  const auditLogRows = perPractice.flatMap(([auditLogs]) => auditLogs);
  const phiAccessRows = perPractice.flatMap(([, phiEvents]) => phiEvents);
  const carrierBlockRows = perPractice.flatMap(([, , carrierBlocks]) => carrierBlocks);

  const roster = await prisma.organizationMember.findMany({
    where: { organizationId },
    select: {
      userId: true, role: true, createdAt: true,
      user: { select: { email: true, displayName: true, isActive: true, practiceId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const rosterRows = roster.map((m) => ({
    userId: m.userId,
    orgRole: m.role,
    email: m.user.email,
    displayName: m.user.displayName,
    isActive: m.user.isActive,
    homePracticeId: m.user.practiceId,
    joinedAt: m.createdAt,
  }));

  // Org-scoped, not practice-scoped — organizations/organization_members-family
  // tables are outside RLS by design (see plan notes on the org-graph tables),
  // so this reads directly by organizationId, no runWithPracticeRls needed.
  const ssoEventRows = await prisma.orgSsoEvent.findMany({
    where: { organizationId, createdAt: { gte: from, lte: to } },
    select: { id: true, createdAt: true, eventType: true, detail: true, actorUserId: true },
    orderBy: { createdAt: 'asc' },
  });

  const files = [
    { name: 'AuditLog.csv', content: toCsv(['id', 'createdAt', 'practiceId', 'userId', 'action', 'subjectType', 'subjectId', 'requestIp'], auditLogRows) },
    { name: 'PhiAccessEvents.csv', content: toCsv(['id', 'createdAt', 'practiceId', 'actorId', 'operation', 'recordType', 'recordId', 'purpose'], phiAccessRows) },
    { name: 'Roster.csv', content: toCsv(['userId', 'orgRole', 'email', 'displayName', 'isActive', 'homePracticeId', 'joinedAt'], rosterRows) },
    { name: 'CarrierBlockEvents.csv', content: toCsv(['id', 'practiceId', 'carrierId', 'blockedAt', 'resumedAt', 'resumedBy', 'notes'], carrierBlockRows) },
    { name: 'SsoEvents.csv', content: toCsv(['id', 'createdAt', 'eventType', 'detail', 'actorUserId'], ssoEventRows) },
  ];

  const buffer = await zipCsvFiles(files);
  const checksum = createHash('sha256').update(buffer).digest('hex');
  return { buffer, checksum };
}
