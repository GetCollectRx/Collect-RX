import bcrypt from 'bcryptjs';
import { db } from '../db';
import type { Patient, PatientStatus, ResponseRate, EmailType } from '../../types';

const FIRST_NAMES = [
  'Sarah','Michael','Emily','David','Jessica','Robert','Amanda','James','Lisa','Kevin',
  'Rachel','Daniel','Jennifer','William','Ashley','Christopher','Nicole','Matthew',
  'Elizabeth','Joshua','Megan','Andrew','Stephanie','Joseph','Lauren','Brian',
  'Samantha','Ryan','Brittany','Nicholas',
];
const LAST_NAMES = [
  'Johnson','Chen','Rodriguez','Thompson','Lee','Martinez','Wilson','Brown','Garcia',
  'Anderson','Taylor','Moore','Thomas','Jackson','White','Harris','Martin','Davis',
  'Miller','Lopez','Gonzalez','Hernandez','King','Wright','Hill','Scott','Green',
  'Adams','Baker','Nelson',
];
const STATUSES: PatientStatus[] = ['pending_payment', 'payment_plan', 'responsive', 'needs_attention'];
const EMAIL_TYPES: EmailType[] = ['initial', 'followup_1', 'followup_2'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generatePatients(): Map<string, Patient> {
  const patients = new Map<string, Patient>();

  for (let i = 1; i <= 100; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const status = pick(STATUSES);
    const balance = Math.floor(Math.random() * 4500) + 200;
    const daysOut = Math.floor(Math.random() * 150) + 5;
    const attempts = Math.floor(Math.random() * 10) + 1;
    const opens = Math.floor(Math.random() * attempts);
    const clicks = Math.floor(Math.random() * opens);
    const responseRate: ResponseRate =
      opens >= attempts * 0.7 ? 'high' : opens >= attempts * 0.4 ? 'medium' : 'low';

    const patient: Patient = {
      id: `patient_${String(i).padStart(3, '0')}`,
      practiceId: 'practice_001',
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@email.com`,
      phone: `(${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
      balanceAmount: balance,
      originalBalance: balance,
      balanceId: `balance_${String(i).padStart(3, '0')}`,
      lastVisitDate: new Date(Date.now() - daysOut * 24 * 60 * 60 * 1000).toISOString(),
      daysOutstanding: daysOut,
      emailOptOut: false,
      emailContactAttempts: attempts,
      lastEmailSentAt: new Date(Date.now() - Math.random() * 10 * 24 * 60 * 60 * 1000).toISOString(),
      lastEmailType: pick(EMAIL_TYPES),
      emailOpens: opens,
      emailClicks: clicks,
      paymentLinkClicked: clicks > 0,
      status,
      responseRate,
      createdAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    };

    if (status === 'payment_plan') {
      const monthlyAmount = Math.floor(balance / 6);
      patient.paymentPlanActive = true;
      patient.paymentPlanAmount = monthlyAmount;
      patient.paymentPlanMonths = 6;
      patient.paymentPlanStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      patient.paymentPlanNextDue = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    }

    patients.set(patient.id, patient);
  }

  return patients;
}

export function seedDatabase() {
  const practiceId = 'practice_001';

  const pw = process.env.PRACTICE_DEFAULT_PASSWORD || 'changeme';
  const passwordHash = bcrypt.hashSync(pw, 12);
  if (!process.env.PRACTICE_DEFAULT_PASSWORD) {
    console.log('   Default practice password: changeme (set PRACTICE_DEFAULT_PASSWORD to override)');
  }

  db.practices.set(practiceId, {
    id: practiceId,
    name: 'Smile Dental Care',
    email: 'billing@smiledental.com',
    phone: '(416) 555-0100',
    address: '123 Main St, Toronto, ON M5V 3A8',
    plan: 'Professional',
    monthlyFee: 349,
    stripeConnectAccountId: 'acct_test123',
    settings: { emailsEnabled: true, automationEnabled: true, sendFromPracticeEmail: false },
    createdAt: new Date('2025-01-01').toISOString(),
    passwordHash,
  });

  const patients = generatePatients();
  patients.forEach((p, id) => db.patients.set(id, p));

  const templates = [
    {
      id: 'template_initial',
      practiceId,
      templateType: 'initial',
      emailType: 'initial' as EmailType,
      name: 'Initial Balance Notification',
      subject: 'Payment reminder from {{practiceName}}',
      htmlContent: `<!DOCTYPE html><html><body><div>Hi {{patientFirstName}}, you have a balance of {{balance}}. <a href="{{paymentLink}}">Pay Now</a></div></body></html>`,
      isActive: true,
    },
    {
      id: 'template_followup_1',
      practiceId,
      templateType: 'followup_1',
      emailType: 'followup_1' as EmailType,
      name: 'First Follow-up',
      subject: 'Reminder: Outstanding balance of {{balance}}',
      htmlContent: `<!DOCTYPE html><html><body><div>Hi {{patientFirstName}}, this is a follow-up. Balance: {{balance}}. <a href="{{paymentLink}}">Pay Now</a></div></body></html>`,
      isActive: true,
    },
  ];
  templates.forEach((t) => db.emailTemplates.set(t.id, t));

  const workflows = [
    {
      id: 'workflow_initial',
      practiceId,
      name: 'Initial Balance Notification',
      templateId: 'template_initial',
      emailType: 'initial' as EmailType,
      priority: 1,
      isActive: true,
      trigger: {
        type: 'days_outstanding',
        value: 7,
        conditions: { minBalance: 0, excludeIfEmailSent: true },
      },
    },
    {
      id: 'workflow_followup_1',
      practiceId,
      name: 'First Follow-up',
      templateId: 'template_followup_1',
      emailType: 'followup_1' as EmailType,
      priority: 2,
      isActive: true,
      trigger: {
        type: 'days_outstanding',
        value: 14,
        conditions: { minBalance: 0, requiresPreviousEmail: 'initial' as EmailType, daysSinceLastEmail: 7 },
      },
    },
  ];
  workflows.forEach((w) => db.workflowRules.set(w.id, w));

  console.log('✅ Data initialized:');
  console.log(`   • Practices: ${db.practices.size}`);
  console.log(`   • Patients: ${db.patients.size}`);
  console.log(`   • Templates: ${db.emailTemplates.size}`);
  console.log(`   • Workflows: ${db.workflowRules.size}`);
}
