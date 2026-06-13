import type { ProspectSource, ProspectStage } from '@prisma/client';

export type { ProspectSource, ProspectStage };

export const PROSPECT_STAGES: ProspectStage[] = [
  'new',
  'contacted',
  'engaged',
  'qualified',
  'demo_booked',
  'closed_won',
  'closed_lost',
  'opted_out',
];

export const STAGE_LABELS: Record<ProspectStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  engaged: 'Engaged',
  qualified: 'Qualified',
  demo_booked: 'Demo booked',
  closed_won: 'Closed won',
  closed_lost: 'Closed lost',
  opted_out: 'Opted out',
};

export interface ProspectListItem {
  id: string;
  practiceName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  score: number;
  stage: ProspectStage;
  source: ProspectSource;
  lastEngagedAt: string | null;
  lastEmailSentAt: string | null;
  createdAt: string;
}
