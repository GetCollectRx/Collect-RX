import type { EmailType } from './patient';

export type EmailEventType = 'open' | 'click' | 'bounce' | 'unsubscribe';

export interface EmailLog {
  id: string;
  patientId: string;
  practiceId: string;
  workflowId: string;
  emailType: EmailType;
  messageId: string;
  sentAt: string;
  createdAt: string;
}

export interface EmailEvent {
  id: string;
  patientId: string;
  practiceId: string;
  emailType: EmailType;
  eventType: EmailEventType;
  timestamp: string;
  clickedUrl?: string;
  recipientEmail: string;
  createdAt: string;
}

export interface EmailTemplate {
  id: string;
  practiceId: string;
  templateType: string;
  emailType: EmailType;
  name: string;
  subject: string;
  htmlContent: string;
  isActive: boolean;
}

export interface WorkflowTriggerConditions {
  minBalance?: number;
  maxBalance?: number;
  excludeIfEmailSent?: boolean;
  requiresPreviousEmail?: EmailType;
  daysSinceLastEmail?: number;
}

export interface WorkflowTrigger {
  type: string;
  value: number;
  conditions: WorkflowTriggerConditions;
}

export interface WorkflowRule {
  id: string;
  practiceId: string;
  name: string;
  templateId: string;
  emailType: EmailType;
  templateType?: string;
  priority: number;
  isActive: boolean;
  trigger: WorkflowTrigger;
}

export interface EmailStats {
  emailsSent: number;
  openRate: string;
  clickRate: string;
  opens: number;
  clicks: number;
}

export interface SendEmailRequest {
  workflowId: string;
}

export interface SendEmailResponse {
  success: boolean;
  message: string;
}
