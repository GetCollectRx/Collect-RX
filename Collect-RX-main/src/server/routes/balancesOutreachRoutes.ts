import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/authenticate';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../middleware/requirePracticeSession';

function daysOutstanding(dueDate: Date): number {
  return Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86_400_000));
}

/** Insurance `Balance` list + detail + outreach (UI: Balances, BalanceDetail, Outbox). */
export function createBalancesOutreachRouter(prisma: PrismaClient): Router {
  const r = Router();
  r.use(authenticate);

  r.get('/balances', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
      if (queryPracticeConflictsSession(req, q || undefined)) {
        return res.status(403).json({ error: 'practiceId does not match session' });
      }
      const practiceId = practiceIdFromSession(req);
      const stage = typeof req.query.stage === 'string' ? req.query.stage.trim() : '';
      const minAmount = parseFloat(String(req.query.minAmount ?? ''));
      const maxAmount = parseFloat(String(req.query.maxAmount ?? ''));

      const rows = await prisma.balance.findMany({
        where: { practiceId },
        include: {
          patient: { select: { displayName: true } },
          states: { orderBy: { stageAt: 'desc' }, take: 1 },
        },
        orderBy: { dueDate: 'asc' },
        take: 500,
      });

      type Row = {
        id: string;
        patient: { displayName: string };
        amount: number;
        daysOutstanding: number;
        currentStage: string;
        createdAt: string;
      };

      let out: Row[] = rows.map((b) => ({
        id: b.id,
        patient: { displayName: b.patient.displayName },
        amount: b.amountCents / 100,
        daysOutstanding: daysOutstanding(b.dueDate),
        currentStage: b.states[0]?.stage ?? b.status,
        createdAt: b.createdAt.toISOString(),
      }));

      if (stage) {
        out = out.filter((b) => b.currentStage === stage);
      }
      if (!Number.isNaN(minAmount)) {
        out = out.filter((b) => b.amount >= minAmount);
      }
      if (!Number.isNaN(maxAmount) && maxAmount > 0) {
        out = out.filter((b) => b.amount <= maxAmount);
      }

      return res.json(out);
    } catch (e) {
      console.error('GET /balances error', e);
      return res.status(500).json({ error: 'Failed to list balances' });
    }
  });

  r.get('/balances/:id', async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const id = req.params.id;
      const b = await prisma.balance.findFirst({
        where: { id, practiceId },
        include: {
          patient: true,
          practice: { select: { name: true } },
          states: { orderBy: { stageAt: 'asc' } },
          outreachEvents: { orderBy: { sentAt: 'asc' } },
          paymentEvents: { orderBy: { paidAt: 'asc' } },
        },
      });
      if (!b) {
        return res.status(404).json({ error: 'Not found' });
      }
      const currentStage = b.states[b.states.length - 1]?.stage ?? b.status;
      return res.json({
        id: b.id,
        practice: b.practice,
        patient: {
          displayName: b.patient.displayName,
          emailFake: b.patient.emailFake,
          phoneFake: b.patient.phoneFake,
          preferredChannel: b.patient.preferredChannel,
        },
        amount: b.amountCents / 100,
        amountCents: b.amountCents,
        daysOutstanding: daysOutstanding(b.dueDate),
        currentStage,
        status: b.status,
        source: b.source,
        createdAt: b.createdAt.toISOString(),
        dueDate: b.dueDate.toISOString(),
        states: b.states.map((s) => ({
          id: s.id,
          stage: s.stage,
          stageAt: s.stageAt.toISOString(),
        })),
        outreachEvents: b.outreachEvents.map((e) => ({
          id: e.id,
          templateKey: e.templateKey,
          channel: e.channel,
          sentAt: e.sentAt.toISOString(),
          deliveryStatus: e.deliveryStatus,
          responseStatus: e.responseStatus,
          messageBody: e.messageBody,
        })),
        paymentEvents: b.paymentEvents.map((p) => ({
          id: p.id,
          amountCents: p.amountCents,
          paidAt: p.paidAt.toISOString(),
          method: p.method,
          result: p.result,
        })),
      });
    } catch (e) {
      console.error('GET /balances/:id error', e);
      return res.status(500).json({ error: 'Failed to load balance' });
    }
  });

  r.get('/outreach', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
      if (queryPracticeConflictsSession(req, q || undefined)) {
        return res.status(403).json({ error: 'practiceId does not match session' });
      }
      const practiceId = practiceIdFromSession(req);
      const events = await prisma.outreachEvent.findMany({
        where: { balance: { practiceId } },
        include: {
          balance: {
            select: {
              status: true,
              patient: { select: { displayName: true } },
            },
          },
        },
        orderBy: { sentAt: 'desc' },
        take: 200,
      });
      return res.json(
        events.map((e) => ({
          id: e.id,
          templateKey: e.templateKey,
          channel: e.channel,
          sentAt: e.sentAt.toISOString(),
          deliveryStatus: e.deliveryStatus,
          responseStatus: e.responseStatus,
          messageBody: e.messageBody,
          balance: {
            status: e.balance.status,
            patient: { displayName: e.balance.patient.displayName },
          },
        })),
      );
    } catch (e) {
      console.error('GET /outreach error', e);
      return res.status(500).json({ error: 'Failed to list outreach' });
    }
  });

  const allowedResponses = new Set(['NONE', 'PAY', 'QUESTION', 'DISPUTE']);

  r.post('/outreach/:id/respond', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const responseType = String((req.body as { responseType?: string })?.responseType ?? '').trim();
      if (!allowedResponses.has(responseType)) {
        return res.status(400).json({ error: 'Invalid responseType' });
      }
      const ev = await prisma.outreachEvent.findFirst({
        where: { id, balance: { practiceId: practiceIdFromSession(req) } },
        select: { id: true },
      });
      if (!ev) {
        return res.status(404).json({ error: 'Not found' });
      }
      await prisma.outreachEvent.update({
        where: { id },
        data: { responseStatus: responseType },
      });
      return res.json({ ok: true });
    } catch (e) {
      console.error('POST /outreach/:id/respond error', e);
      return res.status(500).json({ error: 'Failed to update response' });
    }
  });

  /** Demo / staff-simulated payment on insurance `Balance` (see PaymentPage). */
  r.post('/pay/:balanceId', async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const balanceId = req.params.balanceId;
      const b = await prisma.balance.findFirst({
        where: { id: balanceId, practiceId },
        select: { id: true, amountCents: true, status: true },
      });
      if (!b) {
        return res.status(404).json({ error: 'Not found' });
      }
      if (b.status === 'PAID') {
        return res.json({ ok: true, alreadyPaid: true });
      }

      await prisma.$transaction([
        prisma.balance.update({
          where: { id: b.id },
          data: { status: 'PAID' },
        }),
        prisma.paymentEvent.create({
          data: {
            balanceId: b.id,
            amountCents: b.amountCents,
            method: 'DEMO_PORTAL',
            result: 'SUCCESS',
          },
        }),
      ]);

      return res.json({ ok: true });
    } catch (e) {
      console.error('POST /pay/:balanceId error', e);
      return res.status(500).json({ error: 'Failed to record payment' });
    }
  });

  return r;
}
