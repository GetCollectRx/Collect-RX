// ─────────────────────────────────────────────────────────────────────────────
// Breach register admin API (privacy control W4).
//
// Mounted only when PHIPA_BREACH_REGISTER_ENABLED=true (default off, so merging
// this file does not change any production route surface).
//
//   GET    /api/practices/:practiceId/breach-register            list
//   POST   /api/practices/:practiceId/breach-register            create (validated)
//   PATCH  /api/practices/:practiceId/breach-register/:id        update notification fields
//   GET    /api/practices/:practiceId/breach-register/:id/packet practice-facing packet
//   GET    /api/practices/:practiceId/breach-register/counts?year=YYYY
//
// Tenant scoping: requirePracticeContext plus queryPracticeConflictsSession on
// the path practice; RLS on phipa_breach_notifications is forced in the database.
// Writes require billing-ops or practice-owner roles (blockAuditorWrites first).
// No free-text identifiers are logged; audit writes record ids and operations only.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
  requirePracticeContext,
} from '../middleware/requirePracticeSession.js';
import { blockAuditorWrites, blockFrontDeskReports, requireBillingOps } from '../middleware/requireUserRole.js';
import { appendPhiAccessEvent } from '../audit/auditLog.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import {
  ANNUAL_REPORT_CATEGORIES,
  BREACH_CATEGORIES,
  buildBreachPacket,
  validateRegisterEntry,
  yearlyAnnualCounts,
  type BreachRegisterInput,
} from '../compliance/breachRegister.js';

const DATA_ELEMENTS = ['CONTACT', 'HEALTH_RECORD', 'INSURANCE_IDENTIFIER', 'BILLING', 'OTHER'] as const;
const ANNUAL_CATEGORIES = ANNUAL_REPORT_CATEGORIES;

const createBody = z.object({
  notificationType: z.enum(BREACH_CATEGORIES),
  description: z.string().min(1).max(2000),
  discoveredAt: z.coerce.date(),
  notificationDeadline: z.coerce.date().optional(),
  circumstances: z.string().max(4000).optional().nullable(),
  occurredFrom: z.coerce.date().optional().nullable(),
  occurredTo: z.coerce.date().optional().nullable(),
  dataElements: z.array(z.enum(DATA_ELEMENTS)).optional().nullable(),
  numberOfIndividuals: z.number().int().min(0).optional().nullable(),
  stepsToReduceHarm: z.string().max(4000).optional().nullable(),
  notificationSteps: z.string().max(4000).optional().nullable(),
  contactName: z.string().max(200).optional().nullable(),
  affectedPatientToken: z.string().max(128).optional().nullable(),
  annualCategories: z.array(z.enum(ANNUAL_CATEGORIES)).optional().nullable(),
  realRiskOfSignificantHarm: z.boolean().optional().nullable(),
  custodianNotifiedAt: z.coerce.date().optional().nullable(),
});

const patchBody = z
  .object({
    circumstances: z.string().max(4000).optional().nullable(),
    stepsToReduceHarm: z.string().max(4000).optional().nullable(),
    notificationSteps: z.string().max(4000).optional().nullable(),
    contactName: z.string().max(200).optional().nullable(),
    numberOfIndividuals: z.number().int().min(0).optional().nullable(),
    dataElements: z.array(z.enum(DATA_ELEMENTS)).optional().nullable(),
    annualCategories: z.array(z.enum(ANNUAL_CATEGORIES)).optional().nullable(),
    realRiskOfSignificantHarm: z.boolean().optional().nullable(),
    custodianNotifiedAt: z.coerce.date().optional().nullable(),
    remediationCompleted: z.coerce.date().optional().nullable(),
  })
  .strict();

function sendError(res: Response, status: number, error: string, detail?: unknown): void {
  res.status(status).json({ success: false, error, ...(detail ? { detail } : {}) });
}

function scopeOrReject(req: Request, res: Response): string | null {
  const practiceId = req.params.practiceId;
  if (queryPracticeConflictsSession(req, practiceId)) {
    sendError(res, 403, 'practiceId does not match session');
    return null;
  }
  return practiceId || practiceIdFromSession(req);
}

function toRegisterInput(row: {
  notificationType: string;
  createdAt: Date;
  discoveredAt: Date | null;
  circumstances: string | null;
  occurredFrom: Date | null;
  occurredTo: Date | null;
  dataElements: string[] | null;
  annualCategories: string[] | null;
  numberOfIndividuals: number | null;
  stepsToReduceHarm: string | null;
  notificationSteps: string | null;
  contactName: string | null;
  realRiskOfSignificantHarm: boolean | null;
  custodianNotifiedAt: Date | null;
}): BreachRegisterInput {
  return {
    notificationType: row.notificationType,
    discoveredAt: row.discoveredAt ?? row.createdAt,
    circumstances: row.circumstances,
    occurredFrom: row.occurredFrom,
    occurredTo: row.occurredTo,
    dataElements: row.dataElements,
    annualCategories: row.annualCategories,
    numberOfIndividuals: row.numberOfIndividuals,
    stepsToReduceHarm: row.stepsToReduceHarm,
    notificationSteps: row.notificationSteps,
    contactName: row.contactName,
    realRiskOfSignificantHarm: row.realRiskOfSignificantHarm,
    custodianNotifiedAt: row.custodianNotifiedAt,
  };
}

export function createBreachRegisterRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.use(requirePracticeContext);

  router.get('/:practiceId/breach-register', blockFrontDeskReports, async (req, res) => {
    const practiceId = scopeOrReject(req, res);
    if (!practiceId) return;
    try {
      const rows = await prisma.pHIPABreachNotification.findMany({
        where: { practiceId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      res.json({ success: true, data: rows });
    } catch (err) {
      sendError(res, 500, apiErrorMessageForResponse(err));
    }
  });

  router.post('/:practiceId/breach-register', blockAuditorWrites, requireBillingOps, async (req, res) => {
    const practiceId = scopeOrReject(req, res);
    if (!practiceId) return;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'invalid body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      return;
    }
    const b = parsed.data;
    const input: BreachRegisterInput = {
      notificationType: b.notificationType,
      discoveredAt: b.discoveredAt,
      circumstances: b.circumstances,
      occurredFrom: b.occurredFrom,
      occurredTo: b.occurredTo,
      dataElements: b.dataElements,
      annualCategories: b.annualCategories,
      numberOfIndividuals: b.numberOfIndividuals,
      stepsToReduceHarm: b.stepsToReduceHarm,
      notificationSteps: b.notificationSteps,
      contactName: b.contactName,
      realRiskOfSignificantHarm: b.realRiskOfSignificantHarm,
      custodianNotifiedAt: b.custodianNotifiedAt,
    };
    const check = validateRegisterEntry(input);
    if (!check.ok) {
      sendError(res, 422, 'register entry incomplete', { missing: check.missing, reasons: check.reasons });
      return;
    }
    try {
      const row = await prisma.pHIPABreachNotification.create({
        data: {
          practiceId,
          notificationType: b.notificationType,
          description: b.description,
          notificationDeadline: b.notificationDeadline ?? b.discoveredAt,
          affectedPatientToken: b.affectedPatientToken ?? null,
          circumstances: b.circumstances ?? null,
          occurredFrom: b.occurredFrom ?? null,
          occurredTo: b.occurredTo ?? null,
          discoveredAt: b.discoveredAt,
          dataElements: b.dataElements ?? [],
          annualCategories: b.annualCategories ?? [],
          numberOfIndividuals: b.numberOfIndividuals ?? null,
          stepsToReduceHarm: b.stepsToReduceHarm ?? null,
          notificationSteps: b.notificationSteps ?? null,
          contactName: b.contactName ?? null,
          realRiskOfSignificantHarm: b.realRiskOfSignificantHarm ?? null,
          custodianNotifiedAt: b.custodianNotifiedAt ?? null,
        },
      });
      await appendPhiAccessEvent(prisma, {
        practiceId,
        operation: 'breach_register_create',
        recordType: 'PHIPABreachNotification',
        recordId: row.id,
        required: true,
      });
      res.status(201).json({ success: true, data: row });
    } catch (err) {
      sendError(res, 500, apiErrorMessageForResponse(err));
    }
  });

  router.patch('/:practiceId/breach-register/:id', blockAuditorWrites, requireBillingOps, async (req, res) => {
    const practiceId = scopeOrReject(req, res);
    if (!practiceId) return;
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'invalid body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      return;
    }
    try {
      const existing = await prisma.pHIPABreachNotification.findFirst({
        where: { id: req.params.id, practiceId },
      });
      if (!existing) {
        sendError(res, 404, 'breach record not found');
        return;
      }
      const merged = { ...existing, ...parsed.data };
      const check = validateRegisterEntry(toRegisterInput(merged));
      if (!check.ok) {
        sendError(res, 422, 'register entry incomplete', { missing: check.missing, reasons: check.reasons });
        return;
      }
      const { dataElements, annualCategories, ...rest } = parsed.data;
      const row = await prisma.pHIPABreachNotification.update({
        where: { id: existing.id },
        data: {
          ...rest,
          ...(dataElements ? { dataElements } : {}),
          ...(annualCategories ? { annualCategories } : {}),
        },
      });
      await appendPhiAccessEvent(prisma, {
        practiceId,
        operation: 'breach_register_update',
        recordType: 'PHIPABreachNotification',
        recordId: row.id,
        required: true,
      });
      res.json({ success: true, data: row });
    } catch (err) {
      sendError(res, 500, apiErrorMessageForResponse(err));
    }
  });

  router.get('/:practiceId/breach-register/:id/packet', blockFrontDeskReports, async (req, res) => {
    const practiceId = scopeOrReject(req, res);
    if (!practiceId) return;
    try {
      const row = await prisma.pHIPABreachNotification.findFirst({
        where: { id: req.params.id, practiceId },
      });
      if (!row) {
        sendError(res, 404, 'breach record not found');
        return;
      }
      const packet = buildBreachPacket({
        ...toRegisterInput(row),
        affectedPatientTokens: row.affectedPatientToken ? [row.affectedPatientToken] : [],
      });
      await appendPhiAccessEvent(prisma, {
        practiceId,
        operation: 'breach_packet_export',
        recordType: 'PHIPABreachNotification',
        recordId: row.id,
        required: true,
      });
      res.json({ success: true, data: packet });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.startsWith('breach register entry incomplete')) {
        sendError(res, 422, message);
        return;
      }
      sendError(res, 500, apiErrorMessageForResponse(err));
    }
  });

  router.get('/:practiceId/breach-register/counts', blockFrontDeskReports, async (req, res) => {
    const practiceId = scopeOrReject(req, res);
    if (!practiceId) return;
    const year = Number(req.query.year ?? new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      sendError(res, 400, 'year must be a four-digit year');
      return;
    }
    try {
      const rows = await prisma.pHIPABreachNotification.findMany({
        where: { practiceId },
        select: { annualCategories: true, createdAt: true, discoveredAt: true },
      });
      const counts = yearlyAnnualCounts(
        rows.map((r) => ({ annualCategories: r.annualCategories, discoveredAt: r.discoveredAt ?? r.createdAt })),
        year,
      );
      res.json({ success: true, data: { year, source: 'O. Reg. 329/04 s.6.4(1)', counts } });
    } catch (err) {
      sendError(res, 500, apiErrorMessageForResponse(err));
    }
  });

  return router;
}
