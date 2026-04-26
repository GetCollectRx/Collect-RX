import { Router } from 'express';
import { scopedDb } from '../db';
import { authenticate } from '../middleware/authenticate';
import { authorizePractice } from '../middleware/authorize';
import { validate, schemas } from '../middleware/validate';
import type { PatientSummary } from '../../types';

export const practicesRouter = Router();

function sanitizePractice(practice: any) {
  const { stripeConnectAccountId, settings, passwordHash, ...safe } = practice;
  return safe;
}

function toPatientSummary(p: any): PatientSummary {
  return {
    id: p.id,
    practiceId: p.practiceId,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    balanceAmount: p.balanceAmount,
    daysOutstanding: p.daysOutstanding,
    status: p.status,
    emailContactAttempts: p.emailContactAttempts,
    lastEmailSentAt: p.lastEmailSentAt,
    lastEmailType: p.lastEmailType,
    responseRate: p.responseRate,
    paymentPlanActive: p.paymentPlanActive || false,
    paymentPlanAmount: p.paymentPlanAmount || null,
    emailClicks: p.emailClicks ?? 0,
    paymentLinkClicked: p.paymentLinkClicked ?? false,
  };
}

practicesRouter.get('/:practiceId/dashboard', authenticate, authorizePractice, async (req, res) => {
  try {
    const scoped = scopedDb();
    const practice = scoped.practice();
    if (!practice) return res.status(404).json({ error: 'Practice not found' });

    const patients = scoped.patients.all();
    const totalAR = patients.reduce((sum, p) => sum + p.balanceAmount, 0);
    const emailLogs = scoped.emailLogs.all();
    const payments = scoped.payments.all();

    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const monthlyPayments = payments.filter((p) => new Date(p.processedAt) >= thisMonth);
    const monthlyRecovered = monthlyPayments.reduce((sum, p) => sum + p.amount, 0);
    const monthlyEmailsSent = emailLogs.filter((log) => new Date(log.sentAt) >= thisMonth).length;

    res.json({
      practice: sanitizePractice({ ...practice, totalAR, activeBalances: patients.length }),
      metrics: {
        monthlyRecovered,
        recoveryRate: 78,
        avgDaysToCollect: 12,
        emailsSent: monthlyEmailsSent,
        paymentsReceived: monthlyPayments.length,
        automationSavings: 2100,
      },
      stats: {
        totalPatients: patients.length,
        patientsWithBalance: patients.filter((p) => p.balanceAmount > 0).length,
        patientsPaid: patients.filter((p) => p.status === 'paid').length,
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

practicesRouter.get(
  '/:practiceId/patients',
  authenticate,
  authorizePractice,
  validate(schemas.paginationQuery, 'query'),
  (req, res) => {
    try {
      const { status, search, page, limit } = req.query as any;

      let patients = scopedDb().patients.all();

      if (status && status !== 'all') {
        patients = patients.filter((p) => p.status === status);
      }
      if (search) {
        const q = (search as string).toLowerCase();
        patients = patients.filter(
          (p) =>
            p.firstName.toLowerCase().includes(q) ||
            p.lastName.toLowerCase().includes(q) ||
            p.email.toLowerCase().includes(q)
        );
      }

      const total = patients.length;
      const totalPages = Math.ceil(total / limit);
      const paginated = patients.slice((page - 1) * limit, page * limit);

      res.json({
        patients: paginated.map(toPatientSummary),
        pagination: { page, limit, total, totalPages },
      });
    } catch (err) {
      console.error('Patient list error:', err);
      res.status(500).json({ error: 'Failed to load patients' });
    }
  }
);

practicesRouter.get('/:practiceId/email-stats', authenticate, authorizePractice, (req, res) => {
  try {
    const { timeframe = 'month' } = req.query;
    const startDate = new Date();
    if (timeframe === 'week') startDate.setDate(startDate.getDate() - 7);
    else if (timeframe === 'month') startDate.setMonth(startDate.getMonth() - 1);
    else if (timeframe === 'quarter') startDate.setMonth(startDate.getMonth() - 3);

    const scoped = scopedDb();
    const logs = scoped.emailLogs.all().filter((log) => new Date(log.sentAt) >= startDate);
    const events = scoped.emailEvents.all().filter((e) => new Date(e.createdAt) >= startDate);

    const sent = logs.length;
    const opens = events.filter((e) => e.eventType === 'open').length;
    const clicks = events.filter((e) => e.eventType === 'click').length;

    res.json({
      emailsSent: sent,
      openRate: sent > 0 ? ((opens / sent) * 100).toFixed(1) : '0.0',
      clickRate: sent > 0 ? ((clicks / sent) * 100).toFixed(1) : '0.0',
      opens,
      clicks,
    });
  } catch (err) {
    console.error('Email stats error:', err);
    res.status(500).json({ error: 'Failed to load email statistics' });
  }
});

practicesRouter.get('/:practiceId/workflows', authenticate, authorizePractice, (req, res) => {
  try {
    const workflows = scopedDb().workflowRules.all();
    res.json({ workflows });
  } catch (err) {
    console.error('Workflows error:', err);
    res.status(500).json({ error: 'Failed to load workflows' });
  }
});
