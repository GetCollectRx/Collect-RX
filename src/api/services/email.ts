import { config } from '../config';
import { db } from '../db';
import { generateId } from '../helpers';
import type { EmailLog, EmailEvent, EmailEventType } from '../../types';

interface SendEmailData {
  patientEmail: string;
  patientId: string;
  practiceId: string;
  practiceName: string;
  subject: string;
  htmlContent: string;
  workflowId: string;
  emailType: string;
}

interface LogEmailData {
  patientId: string;
  practiceId: string;
  workflowId: string;
  emailType: string;
  messageId: string;
  sentAt: string;
}

interface TrackEventData {
  patientId: string;
  practiceId: string;
  emailType: string;
  eventType: EmailEventType;
  timestamp: string;
  clickedUrl?: string;
  recipientEmail: string;
}

export class EmailService {
  private mockMode = config.sendgrid.mockMode;

  async sendEmail(data: SendEmailData): Promise<{ messageId: string; status: string }> {
    if (this.mockMode) {
      const messageId = generateId('msg');
      console.log(`📧 [MOCK] Email sent to ${data.patientEmail} | Subject: ${data.subject}`);
      return { messageId, status: 'sent' };
    }
    // Real SendGrid: uncomment when SENDGRID_API_KEY is set
    // const sgMail = require('@sendgrid/mail');
    // sgMail.setApiKey(config.sendgrid.apiKey);
    // const response = await sgMail.send({ ... });
    // return { messageId: response[0].headers['x-message-id'], status: 'sent' };
    throw new Error('SendGrid not configured');
  }

  async logEmailSent(data: LogEmailData): Promise<EmailLog> {
    const log: EmailLog = {
      id: generateId('log'),
      ...(data as any),
      createdAt: new Date().toISOString(),
    };
    db.emailLogs.set(log.id, log);
    return log;
  }

  async trackEvent(data: TrackEventData): Promise<EmailEvent> {
    const event: EmailEvent = {
      id: generateId('event'),
      ...(data as any),
      createdAt: new Date().toISOString(),
    };
    db.emailEvents.set(event.id, event);

    const patient = db.patients.get(data.patientId);
    if (patient) {
      if (data.eventType === 'open') {
        patient.emailOpens = (patient.emailOpens || 0) + 1;
        patient.lastEngagementAt = new Date().toISOString();
        patient.lastEngagementType = 'email_open';
      }
      if (data.eventType === 'click') {
        patient.emailClicks = (patient.emailClicks || 0) + 1;
        patient.lastEngagementAt = new Date().toISOString();
        patient.lastEngagementType = 'email_click';
        if (data.clickedUrl?.includes('pay.')) {
          patient.paymentLinkClicked = true;
          patient.paymentLinkClickedAt = new Date().toISOString();
        }
      }
      db.patients.set(patient.id, patient);
    }

    return event;
  }
}
