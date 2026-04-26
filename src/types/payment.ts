export interface Payment {
  id: string;
  patientId: string;
  practiceId: string;
  amount: number;
  paymentMethod: string;
  status: 'completed' | 'failed' | 'pending';
  stripePaymentId: string;
  processedAt: string;
}

export interface PaymentPlan {
  id: string;
  patientId: string;
  practiceId: string;
  totalAmount: number;
  monthlyAmount: number;
  numberOfMonths: number;
  startDate: string;
  nextDueDate: string;
  status: 'active' | 'completed' | 'cancelled';
  createdAt: string;
}

export interface PaymentPlanRequest {
  monthlyAmount: number;
  numberOfMonths: number;
}

export interface PaymentPlanResponse {
  success: boolean;
  paymentPlan: PaymentPlan;
}

export interface PaymentLinkResponse {
  paymentLink: string;
}
