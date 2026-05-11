import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import { authenticate } from '../middleware/authenticate';
import { requireAdmin } from '../middleware/authenticate';
import { authorizePatient } from '../middleware/authorize';
import { validate, schemas } from '../middleware/validate';
import { EmailService } from '../services/email';
import { TemplateEngine } from '../services/templates';
import { PaymentService } from '../services/payment';
import { WorkflowScheduler } from '../services/scheduler';

const emailService = new EmailService();
const templateEngine = new TemplateEngine();
const paymentService = new PaymentService();
export const scheduler = new WorkflowScheduler(emailService, templateEngine, paymentService);

const emailRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `email_${req.params.patientId}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many emails sent to this patient. Try again later.' },
});

export const patientsRouter = Router();

patientsRouter.get('/:patientId', authenticate, authorizePatient, async (req, res) => {
  try {
    const patient = req.patient!;
    const emailLogs = Array.from(db.emailLogs.values())
      .filter((log) => log.patientId === req.params.patientId)
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    const emailEvents = Array.from(db.emailEvents.values())
      .filter((e) => e.patientId === req.params.patientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const payments = Array.from(db.payments.values())
      .filter((p) => p.patientId === req.params.patientId)
      .sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime());

    res.json({ patient, history: { emails: emailLogs, events: emailEvents, payments } });
  } catch (err) {
    console.error('Patient detail error:', err);
    res.status(500).json({ error: 'Failed to load patient details' });
  }
});

patientsRouter.post(
  '/:patientId/send-email',
  authenticate,
  authorizePatient,
  validate(schemas.sendEmail),
  emailRateLimit,
  async (req, res) => {
    try {
      const patient = req.patient!;
      const { workflowId } = req.body;
      const workflow = db.workflowRules.get(workflowId);
      if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

      await scheduler.sendWorkflowEmail(patient, workflow);
      res.json({ success: true, message: `Email sent to ${patient.firstName} ${patient.lastName}` });
    } catch (err) {
      console.error('Send email error:', err);
      res.status(500).json({ error: 'Failed to send email. Please try again.' });
    }
  }
);

patientsRouter.post('/:patientId/payment-link', authenticate, authorizePatient, async (req, res) => {
  try {
    const patient = req.patient!;
    const practice = db.practices.get(patient.practiceId)!;
    const paymentLink = await paymentService.generatePaymentLink(patient, practice);
    res.json({ paymentLink });
  } catch (err) {
    console.error('Payment link error:', err);
    res.status(500).json({ error: 'Failed to generate payment link' });
  }
});

patientsRouter.post(
  '/:patientId/payment-plan',
  authenticate,
  authorizePatient,
  validate(schemas.paymentPlan),
  async (req, res) => {
    try {
      const { monthlyAmount, numberOfMonths } = req.body;
      const patient = req.patient!;
      const paymentPlan = await paymentService.createPaymentPlan(req.params.patientId, {
        totalAmount: patient.balanceAmount,
        monthlyAmount,
        numberOfMonths,
      });
      res.json({ success: true, paymentPlan });
    } catch (err: any) {
      console.error('Payment plan error:', err);
      res.status(400).json({ error: err.message });
    }
  }
);

patientsRouter.post('/admin/run-scheduler', authenticate, requireAdmin, async (req, res) => {
  try {
    const processed = await scheduler.processScheduledEmails();
    res.json({ success: true, message: `Processed ${processed} emails` });
  } catch (err) {
    console.error('Scheduler error:', err);
    res.status(500).json({ error: 'Scheduler failed' });
  }
});
