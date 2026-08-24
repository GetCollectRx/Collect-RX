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
  personaBucket: string | null;
  personaConfidence: string | null;
  personaAssignedAt: string | null;
  lastEngagedAt: string | null;
  lastEmailSentAt: string | null;
  createdAt: string;
}

export interface PipelineProspectCard {
  id: string;
  practiceName: string;
  city: string | null;
  province: string | null;
  score: number;
  stage: ProspectStage;
  email: string | null;
  phone: string | null;
  updatedAt: string;
}

export interface PipelineColumn {
  stage: ProspectStage;
  count: number;
  prospects: PipelineProspectCard[];
}

/** Stages shown in the kanban (active pipeline first). */
export const KANBAN_ACTIVE_STAGES: ProspectStage[] = [
  'new',
  'contacted',
  'engaged',
  'qualified',
  'demo_booked',
];

export const KANBAN_CLOSED_STAGES: ProspectStage[] = [
  'closed_won',
  'closed_lost',
  'opted_out',
];

/** Outreach pipeline's Persona Classifier buckets — see agents/outreach/persona-classifier.md. */
export const PERSONA_BUCKETS = [
  'Owner-Dentist',
  'Office Manager / Practice Administrator',
  'Billing/AR Staff',
  'DSO Growth / Special Markets / Partnerships exec',
  'Regional Ops / Practice Support',
] as const;

export type PersonaBucket = (typeof PERSONA_BUCKETS)[number];

export const PERSONA_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

export type PersonaConfidence = (typeof PERSONA_CONFIDENCE_LEVELS)[number];
