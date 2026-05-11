export type PatientStatus =
  | 'pending_payment'
  | 'payment_plan'
  | 'responsive'
  | 'needs_attention'
  | 'paid';

export type ResponseRate = 'high' | 'medium' | 'low';

export type EmailType = 'initial' | 'followup_1' | 'followup_2';

export interface Patient {
  id: string;
  practiceId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  balanceAmount: number;
  originalBalance: number;
  balanceId: string;
  lastVisitDate: string;
  daysOutstanding: number;
  emailOptOut: boolean;
  emailContactAttempts: number;
  lastEmailSentAt: string | null;
  lastEmailType: EmailType | null;
  emailOpens: number;
  emailClicks: number;
  paymentLinkClicked: boolean;
  paymentLinkClickedAt?: string;
  status: PatientStatus;
  responseRate: ResponseRate;
  createdAt: string;
  lastPaymentDate?: string;
  lastPaymentAmount?: number;
  lastEngagementAt?: string;
  lastEngagementType?: string;
  paymentPlanActive?: boolean;
  paymentPlanId?: string;
  paymentPlanAmount?: number;
  paymentPlanMonths?: number;
  paymentPlanStartDate?: string;
  paymentPlanNextDue?: string;
}

export interface PatientSummary {
  id: string;
  practiceId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  balanceAmount: number;
  daysOutstanding: number;
  status: PatientStatus;
  emailContactAttempts: number;
  lastEmailSentAt: string | null;
  lastEmailType: EmailType | null;
  responseRate: ResponseRate;
  paymentPlanActive: boolean;
  paymentPlanAmount: number | null;
  emailClicks: number;
  paymentLinkClicked: boolean;
}
