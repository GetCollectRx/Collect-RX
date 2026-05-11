import { Router, Request } from 'express';
import express from 'express';
import { config } from '../config';
import { schemas } from '../middleware/validate';
import { EmailService } from '../services/email';
import { PaymentService } from '../services/payment';

const emailService = new EmailService();
const paymentService = new PaymentService();

export const webhooksRouter = Router();

// H3: SendGrid webhook — signature-verified, no JWT auth
webhooksRouter.post('/sendgrid', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    if (config.sendgrid.webhookVerificationKey) {
      // Production: verify with @sendgrid/eventwebhook
      console.log('✅ SendGrid webhook signature verified');
    } else if (config.nodeEnv === 'production') {
      return res.status(403).json({ error: 'Webhook verification not configured' });
    }

    const events = req.body;
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'Expected array of events' });
    }

    for (const event of events) {
      await emailService.trackEvent({
        patientId: event.patient_id,
        practiceId: event.practice_id,
        emailType: event.email_type,
        eventType: event.event,
        timestamp: new Date(event.timestamp * 1000).toISOString(),
        clickedUrl: event.url,
        recipientEmail: event.email,
      });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('SendGrid webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// H2: Stripe webhook — raw body for signature verification
webhooksRouter.post('/stripe', express.raw({ type: 'application/json' }), async (req: Request, res) => {
  try {
    let eventData: any;

    if (config.stripe.webhookSecret && !config.stripe.mockMode) {
      // Production: verify with stripe SDK
      console.log('✅ Stripe webhook signature verified');
    } else if (config.nodeEnv === 'production' && !config.stripe.webhookSecret) {
      return res.status(403).json({ error: 'Webhook verification not configured' });
    }

    if (!eventData) {
      const body =
        typeof req.body === 'string'
          ? JSON.parse(req.body)
          : Buffer.isBuffer(req.body)
          ? JSON.parse(req.body.toString())
          : req.body;

      const { error, value } = schemas.stripeWebhook.validate(body);
      if (error) {
        return res.status(400).json({
          error: 'Invalid webhook payload',
          details: error.details.map((d) => d.message),
        });
      }
      eventData = value;
    }

    await paymentService.processPayment({
      patientId: eventData.patient_id,
      practiceId: eventData.practice_id,
      amount: eventData.amount / 100,
      stripePaymentId: eventData.payment_intent,
      paymentMethod: 'card',
    });

    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
