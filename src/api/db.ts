import type {
  Patient,
  Practice,
  EmailLog,
  EmailEvent,
  EmailTemplate,
  WorkflowRule,
  Payment,
  PaymentPlan,
} from '../types';
import { requestContext } from './context';

export const db = {
  practices: new Map<string, Practice>(),
  patients: new Map<string, Patient>(),
  emailTemplates: new Map<string, EmailTemplate>(),
  emailLogs: new Map<string, EmailLog>(),
  emailEvents: new Map<string, EmailEvent>(),
  workflowRules: new Map<string, WorkflowRule>(),
  payments: new Map<string, Payment>(),
  paymentPlans: new Map<string, PaymentPlan>(),
};

export function scopedDb() {
  const id = requestContext.practiceId();
  return {
    practice: (): Practice | undefined => db.practices.get(id),
    patients: {
      all: (): Patient[] => Array.from(db.patients.values()).filter((p) => p.practiceId === id),
    },
    emailLogs: {
      all: (): EmailLog[] => Array.from(db.emailLogs.values()).filter((l) => l.practiceId === id),
    },
    emailEvents: {
      all: (): EmailEvent[] =>
        Array.from(db.emailEvents.values()).filter((e) => e.practiceId === id),
    },
    workflowRules: {
      all: (): WorkflowRule[] =>
        Array.from(db.workflowRules.values()).filter((w) => w.practiceId === id),
    },
    payments: {
      all: (): Payment[] => Array.from(db.payments.values()).filter((p) => p.practiceId === id),
    },
  };
}
