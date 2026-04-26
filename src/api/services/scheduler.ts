import { db } from '../db';
import type { Patient, WorkflowRule } from '../../types';
import type { EmailService } from './email';
import type { TemplateEngine } from './templates';
import type { PaymentService } from './payment';

export class WorkflowScheduler {
  constructor(
    private emailService: EmailService,
    private templateEngine: TemplateEngine,
    private paymentService: PaymentService
  ) {}

  async processScheduledEmails(): Promise<number> {
    console.log('\n🔄 Running workflow scheduler...');

    const workflows = Array.from(db.workflowRules.values())
      .filter((w) => w.isActive)
      .sort((a, b) => a.priority - b.priority);

    let totalProcessed = 0;

    for (const workflow of workflows) {
      const eligible = await this.findEligiblePatients(workflow);
      if (eligible.length > 0) {
        console.log(`  📋 Workflow "${workflow.name}": ${eligible.length} eligible patients`);
        for (const patient of eligible) {
          try {
            await this.sendWorkflowEmail(patient, workflow);
            totalProcessed++;
          } catch (err: any) {
            console.error(`  ❌ Failed to send ${workflow.name} to ${patient.id}:`, err.message);
          }
        }
      }
    }

    console.log(`✅ Processed ${totalProcessed} automated emails\n`);
    return totalProcessed;
  }

  async findEligiblePatients(workflow: WorkflowRule): Promise<Patient[]> {
    const eligible: Patient[] = [];

    for (const patient of db.patients.values()) {
      if (patient.emailOptOut || patient.balanceAmount <= 0) continue;

      // M3: Recalculate daysOutstanding dynamically
      const visitDate = new Date(patient.lastVisitDate);
      patient.daysOutstanding = Math.floor(
        (Date.now() - visitDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (patient.daysOutstanding < workflow.trigger.value) continue;

      const c = workflow.trigger.conditions;
      if (c.minBalance && patient.balanceAmount < c.minBalance) continue;
      if (c.maxBalance && patient.balanceAmount > c.maxBalance) continue;
      if (c.excludeIfEmailSent && patient.lastEmailSentAt) continue;
      if (c.requiresPreviousEmail && patient.lastEmailType !== c.requiresPreviousEmail) continue;
      if (c.daysSinceLastEmail && patient.lastEmailSentAt) {
        const daysSince = Math.floor(
          (Date.now() - new Date(patient.lastEmailSentAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSince < c.daysSinceLastEmail) continue;
      }

      eligible.push(patient);
    }

    return eligible;
  }

  async sendWorkflowEmail(patient: Patient, workflow: WorkflowRule): Promise<void> {
    const practice = db.practices.get(patient.practiceId);
    const template = db.emailTemplates.get(workflow.templateId);

    if (!practice || !template) {
      throw new Error(
        `Missing practice (${patient.practiceId}) or template (${workflow.templateId})`
      );
    }

    const paymentLink = await this.paymentService.generatePaymentLink(patient, practice);

    const rendered = this.templateEngine.renderTemplate(template, {
      patientFirstName: patient.firstName,
      patientLastName: patient.lastName,
      balance: `$${patient.balanceAmount.toLocaleString()}`,
      visitDate: new Date(patient.lastVisitDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      daysOutstanding: String(patient.daysOutstanding),
      practiceName: practice.name,
      practicePhone: practice.phone,
      practiceAddress: practice.address,
      paymentLink,
    });

    const result = await this.emailService.sendEmail({
      patientEmail: patient.email,
      patientId: patient.id,
      practiceId: practice.id,
      practiceName: practice.name,
      subject: rendered.subject,
      htmlContent: rendered.html,
      workflowId: workflow.id,
      emailType: workflow.emailType,
    });

    await this.emailService.logEmailSent({
      patientId: patient.id,
      practiceId: practice.id,
      workflowId: workflow.id,
      emailType: workflow.emailType,
      messageId: result.messageId,
      sentAt: new Date().toISOString(),
    });

    patient.lastEmailSentAt = new Date().toISOString();
    patient.lastEmailType = workflow.emailType;
    patient.emailContactAttempts = (patient.emailContactAttempts || 0) + 1;
    db.patients.set(patient.id, patient);

    console.log(`    ✉️  Sent ${workflow.name} to ${patient.firstName} ${patient.lastName}`);
  }
}
