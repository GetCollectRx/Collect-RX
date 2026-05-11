export interface PracticeSettings {
  emailsEnabled: boolean;
  automationEnabled: boolean;
  sendFromPracticeEmail: boolean;
}

export interface Practice {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  plan: string;
  monthlyFee: number;
  stripeConnectAccountId: string;
  settings: PracticeSettings;
  createdAt: string;
  /** bcrypt hash; server-only, never returned to clients */
  passwordHash?: string;
}

export interface PracticePublic extends Omit<Practice, 'stripeConnectAccountId' | 'settings'> {
  totalAR?: number;
  activeBalances?: number;
}

export interface DashboardMetrics {
  monthlyRecovered: number;
  recoveryRate: number;
  avgDaysToCollect: number;
  emailsSent: number;
  paymentsReceived: number;
  automationSavings: number;
}

export interface DashboardStats {
  totalPatients: number;
  patientsWithBalance: number;
  patientsPaid: number;
}

export interface DashboardResponse {
  practice: PracticePublic;
  metrics: DashboardMetrics;
  stats: DashboardStats;
}
