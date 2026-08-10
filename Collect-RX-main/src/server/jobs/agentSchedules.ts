/**
 * Agent scheduling configuration derived from agents/runtime/schedules.md
 * All times in ET (America/Toronto)
 * All agents run on Monday (1 = Monday in cron)
 */

interface AgentSchedule {
  name: string;
  cron: string;
  upstreamAgents: string[];
  downstreamAgents: string[];
}

export const AGENT_SCHEDULES: AgentSchedule[] = [
  {
    name: 'analytics-pipeline',
    cron: '0 6 * * 1',
    upstreamAgents: [],
    downstreamAgents: ['risk-radar', 'post-call-debrief', 'hallucination-detector', 'call-quality-scorer'],
  },
  {
    name: 'risk-radar',
    cron: '30 6 * * 1',
    upstreamAgents: ['analytics-pipeline', 'call-quality-scorer', 'hallucination-detector'],
    downstreamAgents: ['incident-response'],
  },
  {
    name: 'post-call-debrief',
    cron: '0 7 * * 1',
    upstreamAgents: ['analytics-pipeline'],
    downstreamAgents: ['carrier-ivr-health', 'escalation-triage'],
  },
  {
    name: 'hallucination-detector',
    cron: '30 7 * * 1',
    upstreamAgents: ['analytics-pipeline'],
    downstreamAgents: ['risk-radar'],
  },
  {
    name: 'call-quality-scorer',
    cron: '0 8 * * 1',
    upstreamAgents: ['analytics-pipeline', 'post-call-debrief'],
    downstreamAgents: ['risk-radar'],
  },
  {
    name: 'carrier-ivr-health',
    cron: '30 8 * * 1',
    upstreamAgents: ['post-call-debrief'],
    downstreamAgents: [],
  },
  {
    name: 'escalation-triage',
    cron: '0 9 * * 1',
    upstreamAgents: ['post-call-debrief'],
    downstreamAgents: [],
  },
  {
    name: 'collections-performance',
    cron: '30 9 * * 1',
    upstreamAgents: ['analytics-pipeline', 'hallucination-detector'],
    downstreamAgents: ['roi-proof', 'practice-time-savings'],
  },
  {
    name: 'database-health',
    cron: '0 10 * * 1',
    upstreamAgents: [],
    downstreamAgents: ['risk-radar'],
  },
  {
    name: 'tier-billing-health',
    cron: '30 10 * * 1',
    upstreamAgents: ['analytics-pipeline'],
    downstreamAgents: ['client-acquisition'],
  },
  {
    name: 'phi-access-log-reviewer',
    cron: '0 11 * * 1',
    upstreamAgents: [],
    downstreamAgents: ['compliance-checker'],
  },
  {
    name: 'compliance-checker',
    cron: '30 11 * * 1',
    upstreamAgents: ['phi-access-log-reviewer'],
    downstreamAgents: [],
  },
  {
    name: 'practice-time-savings',
    cron: '0 12 * * 1',
    upstreamAgents: ['analytics-pipeline', 'collections-performance'],
    downstreamAgents: ['roi-proof'],
  },
  {
    name: 'roi-proof',
    cron: '30 12 * * 1',
    upstreamAgents: ['practice-time-savings', 'collections-performance'],
    downstreamAgents: [],
  },
  {
    name: 'voice-of-customer',
    cron: '0 13 * * 1',
    upstreamAgents: ['escalation-triage', 'post-call-debrief'],
    downstreamAgents: [],
  },
  {
    name: 'client-acquisition',
    cron: '30 13 * * 1',
    upstreamAgents: ['tier-billing-health'],
    downstreamAgents: [],
  },
  {
    name: 'market-intelligence',
    cron: '0 14 * * 1',
    upstreamAgents: [],
    downstreamAgents: ['competitive-intelligence'],
  },
  {
    name: 'competitive-intelligence',
    cron: '30 14 * * 1',
    upstreamAgents: ['market-intelligence'],
    downstreamAgents: [],
  },
  {
    name: 'project-manager',
    cron: '0 15 * * 1',
    upstreamAgents: [
      'analytics-pipeline',
      'risk-radar',
      'post-call-debrief',
      'hallucination-detector',
      'call-quality-scorer',
      'carrier-ivr-health',
      'escalation-triage',
      'collections-performance',
      'database-health',
      'tier-billing-health',
      'phi-access-log-reviewer',
      'compliance-checker',
      'practice-time-savings',
      'roi-proof',
      'voice-of-customer',
      'client-acquisition',
      'market-intelligence',
      'competitive-intelligence',
    ],
    downstreamAgents: [],
  },
];

export function getAgentSchedule(agentName: string): AgentSchedule | undefined {
  return AGENT_SCHEDULES.find((s) => s.name === agentName);
}
