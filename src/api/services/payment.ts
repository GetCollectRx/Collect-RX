import { config } from '../config';
import { db } from '../db';
import { generateId } from '../helpers';
import type { Patient, Practice, Payment, PaymentPlan } from '../../types';

interface ProcessPaymentData {
  patientId: string;
  practiceId: string;
  amount: number;
  stripePaymentId: string;
  paymentMethod?: string;
}

interface CreatePlanData {
  totalAmount: number;
  monthlyAmount: number;
  numberOfMonths: number;
}

export class PaymentService {
  private mockMode = config.stripe.mockMode;

  async generatePaymentLink(patient: Patient, _practice: Practice): Promise<string> {
    if (this.mockMode) {
      return `https://pay.collectrx.com/${generateId('pay')}`;
    }
    // Real Stripe Payment Link: uncomment when STRIPE_SECRET_KEY is set
    throw new Error('Stripe not configured');
  }

  async processPayment(data: ProcessPaymentData): Promise<Payment> {
    if (!data.amount || data.amount <= 0) {
      throw new Error('Payment amount must be a positive number');
    }
    if (data.amount > 100000) {
      throw new Error('Payment amount exceeds maximum allowed ($100,000)');
    }

    // H15: Idempotency — skip if already processed
    if (data.stripePaymentId) {
      const existing = Array.from(db.payments.values()).find(
        (p) => p.stripePaymentId === data.stripePaymentId
      );
      if (existing) {
        console.log(`⚠️ Duplicate payment ignored: ${data.stripePaymentId}`);
        return existing;
      }
    }

    const payment: Payment = {
      id: generateId('payment'),
      patientId: data.patientId,
      practiceId: data.practiceId,
      amount: data.amount,
      paymentMethod: data.paymentMethod || 'card',
      status: 'completed',
      stripePaymentId: data.stripePaymentId,
      processedAt: new Date().toISOString(),
    };
    db.payments.set(payment.id, payment);

    const patient = db.patients.get(data.patientId);
    if (patient) {
      patient.balanceAmount -= data.amount;
      if (patient.balanceAmount <= 0) {
        patient.balanceAmount = 0;
        patient.status = 'paid';
      }
      patient.lastPaymentDate = new Date().toISOString();
      patient.lastPaymentAmount = data.amount;
      db.patients.set(patient.id, patient);
    }

    console.log(`💰 Payment processed: $${data.amount} from patient ${data.patientId}`);
    return payment;
  }

  async createPaymentPlan(patientId: string, planData: CreatePlanData): Promise<PaymentPlan> {
    const patient = db.patients.get(patientId);
    if (!patient) throw new Error('Patient not found');

    const plan: PaymentPlan = {
      id: generateId('plan'),
      patientId,
      practiceId: patient.practiceId,
      totalAmount: planData.totalAmount,
      monthlyAmount: planData.monthlyAmount,
      numberOfMonths: planData.numberOfMonths,
      startDate: new Date().toISOString(),
      nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    db.paymentPlans.set(plan.id, plan);

    patient.paymentPlanActive = true;
    patient.paymentPlanId = plan.id;
    patient.paymentPlanAmount = planData.monthlyAmount;
    patient.status = 'payment_plan';
    db.patients.set(patient.id, patient);

    console.log(
      `📋 Payment plan created for ${patient.firstName} ${patient.lastName}: $${planData.monthlyAmount}/mo x ${planData.numberOfMonths}`
    );
    return plan;
  }
}
