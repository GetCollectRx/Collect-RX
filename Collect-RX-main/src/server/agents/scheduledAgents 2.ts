/**
 * Scheduled Agents — Cron-based registration for CollectRx's autonomous agents.
 *
 * Trigger map (all times ET):
 *
 * DAILY
 *   05:00  analytics-pipeline, database-health
 *   06:00  carrier-ivr-health, tier-billing-health
 *   07:00  hallucination-detector (overnight batch review), phi-access-log-reviewer
 *   08:00  call-quality-scorer, risk-radar
 *   09:00  collections-performance, escalation-triage
 *
 * WEEKLY (Monday)
 *   08:00  compliance-checker
 *   09:00  frontend-auditor, vapi-squad-auditor, practice-time-savings
 *   10:00  roi-proof, security-auditor, voice-agent-trainer
 *   11:00  product-manager, project-manager
 *
 * WEEKLY (Tuesday–Friday)
 *   10:00  market-intelligence (Tue), researcher (Wed),
 *          competitive-intelligence (Thu), voice-of-customer (Fri)
 *   10:00  client-acquisition (Tue)
 */

import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { runAgent } from './agentRunner.js';
import { sendWeeklyPilotReports, weeklyPilotReportEnabled } from '../reports/weeklyPilotReport.js';

type AgentContextBuilder = (prisma: PrismaClient) => Promise<Record<string, unknown>>;

interface ScheduledAgent {
  name: string;
  cron: string;
  buildContext: AgentContextBuilder;
}

// ── Context builders ──────────────────────────────────────────────────────────
// Each builder queries Prisma for data relevant to that agent's analysis.

async function buildCarrierIvrContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const outcomes = await prisma.callAttempt.groupBy({
    by: ['outcome'],
    where: { completedAt: { gte: since } },
    _count: { _all: true },
  }).catch(() => []);
  return { windowDays: 30, outcomeCounts: outcomes };
}

async function buildDatabaseHealthContext(prisma: PrismaClient) {
  const [claimCount, escalationCount, callAttemptCount] = await Promise.all([
    prisma.insuranceClaim.count().catch(() => -1),
    prisma.claimRecoveryAction.count({ where: { actionType: 'HUMAN_ESCALATION' } }).catch(() => -1),
    prisma.callAttempt.count().catch(() => -1),
  ]);
  return {
    tableCounts: { insuranceClaim: claimCount, humanEscalation: escalationCount, callAttempt: callAttemptCount },
    checkedAt: new Date().toISOString(),
  };
}

async function buildTierBillingContext(prisma: PrismaClient) {
  const practices = await prisma.practice.findMany({
    select: { id: true, name: true, billingTier: true },
  }).catch(() => []);
  return {
    practices: practices.map((p) => ({ id: p.id, name: p.name, tier: p.billingTier })),
  };
}

async function buildHallucinationContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentCalls = await prisma.callAttempt.findMany({
    where: { completedAt: { gte: since }, outcome: { in: ['RESOLVED', 'DENIED'] } },
    select: { id: true, vapiCallId: true, outcome: true, claimId: true },
    take: 50,
  }).catch(() => []);
  return { windowHours: 24, highStakesCalls: recentCalls };
}

async function buildPhiAccessLogContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const phiLogs = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: since },
      action: { in: ['PHI_TOKEN_RESOLVED', 'phi.detokenize', 'agent.phi_access'] },
    },
    select: { action: true, createdAt: true, practiceId: true, details: true },
    take: 200,
  }).catch(() => []);
  return { windowHours: 24, phiAccessCount: phiLogs.length, logs: phiLogs.slice(0, 20) };
}

async function buildCallQualityContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const calls = await prisma.callAttempt.findMany({
    where: { completedAt: { gte: since } },
    select: { id: true, outcome: true, durationSeconds: true, claimId: true },
    take: 100,
  }).catch(() => []);
  const byOutcome = calls.reduce<Record<string, { total: number; resolved: number }>>((acc, c) => {
    const key = c.outcome ?? 'UNKNOWN';
    if (!acc[key]) acc[key] = { total: 0, resolved: 0 };
    acc[key].total++;
    if (c.outcome === 'RESOLVED') acc[key].resolved++;
    return acc;
  }, {});
  return { windowHours: 24, totalCalls: calls.length, byOutcome };
}

async function buildRiskRadarContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentAlerts, recentEscalations, recentCarrierBlocks] = await Promise.all([
    prisma.auditLog.findMany({
      where: { createdAt: { gte: since }, action: { contains: 'alert' } },
      select: { action: true, details: true, createdAt: true },
      take: 50,
    }).catch(() => []),
    prisma.claimRecoveryAction.count({
      where: { actionType: 'HUMAN_ESCALATION', createdAt: { gte: since } },
    }).catch(() => 0),
    prisma.auditLog.count({
      where: { createdAt: { gte: since }, action: 'carrier.block' },
    }).catch(() => 0),
  ]);
  return { windowHours: 24, alertCount: recentAlerts.length, escalationCount: recentEscalations, carrierBlockCount: recentCarrierBlocks };
}

async function buildCollectionsContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [resolved, total, byOutcome] = await Promise.all([
    prisma.callAttempt.count({ where: { completedAt: { gte: since }, outcome: 'RESOLVED' } }).catch(() => 0),
    prisma.callAttempt.count({ where: { completedAt: { gte: since } } }).catch(() => 0),
    prisma.callAttempt.groupBy({
      by: ['outcome'],
      where: { completedAt: { gte: since } },
      _count: { _all: true },
    }).catch(() => []),
  ]);
  return { windowDays: 30, resolved, total, successRate: total > 0 ? (resolved / total) : 0, byOutcome };
}

async function buildEscalationTriageContext(prisma: PrismaClient) {
  const open = await prisma.claimRecoveryAction.findMany({
    where: { actionType: 'HUMAN_ESCALATION', clearedAt: null },
    select: { id: true, claimId: true, actionType: true, title: true, detail: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  }).catch(() => []);
  return { openEscalations: open, count: open.length };
}

async function buildAnalyticsPipelineContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [callVolume, outcomes] = await Promise.all([
    prisma.callAttempt.count({ where: { createdAt: { gte: since } } }).catch(() => 0),
    prisma.callAttempt.groupBy({
      by: ['outcome'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }).catch(() => []),
  ]);
  return { windowDays: 7, callVolume, outcomes };
}

async function buildComplianceContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [callCount, practices] = await Promise.all([
    prisma.callAttempt.count({ where: { createdAt: { gte: since } } }).catch(() => 0),
    prisma.practice.findMany({ select: { id: true, name: true, billingTier: true } }).catch(() => []),
  ]);
  return {
    windowDays: 7,
    callsThisWeek: callCount,
    practices: practices.map((p) => ({ id: p.id, name: p.name, billingTier: p.billingTier })),
  };
}

async function buildWeeklyRoiContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const resolved = await prisma.callAttempt.findMany({
    where: { completedAt: { gte: since }, outcome: 'RESOLVED' },
    include: { claim: { select: { billedAmount: true } } },
    take: 500,
  }).catch(() => []);
  const totalRecovered = resolved.reduce((sum, c) => sum + Number(c.claim?.billedAmount ?? 0), 0);
  return { windowDays: 30, resolvedClaims: resolved.length, totalRecovered };
}

async function buildTimeSavingsContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const calls = await prisma.callAttempt.findMany({
    where: { completedAt: { gte: since } },
    select: { durationSeconds: true },
    take: 1000,
  }).catch(() => []);
  const totalMinutes = calls.reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0) / 60;
  return { windowDays: 30, totalCallMinutes: Math.round(totalMinutes), callCount: calls.length };
}

async function buildVapiSquadContext(_prisma: PrismaClient) {
  return {
    squadMembers: ['IVR_Navigator', 'Claims_Agent', 'Escalation_Closer', 'Resolution_Closer'],
    carriers: ['sun-life', 'canada-life', 'manulife', 'green-shield', 'rbc-insurance', 'telus-adjudicare'],
    checkType: 'weekly config audit',
  };
}

async function buildFrontendAuditContext(_prisma: PrismaClient) {
  return {
    targetUrl: 'https://collectrx.ca',
    checkAreas: ['hero stat counters', 'CTA buttons', 'copy accuracy', 'CRTC identification text'],
  };
}

async function buildSecurityAuditContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const phiLogs = await prisma.auditLog.count({
    where: { createdAt: { gte: since }, action: { contains: 'PHI' } },
  }).catch(() => 0);
  return { windowDays: 7, phiAuditEvents: phiLogs, checkAreas: ['vapi payloads', 'log lines', 'db schema', 'token lifecycle'] };
}

async function buildVoiceAgentTrainerContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const debriefs = await prisma.auditLog.findMany({
    where: { createdAt: { gte: since }, action: { in: ['agent.run.post-call-debrief', 'agent.run.call-quality-scorer'] } },
    select: { details: true, createdAt: true },
    take: 50,
  }).catch(() => []);
  return { windowDays: 7, debriefCount: debriefs.length, recentDebriefs: debriefs.slice(0, 5) };
}

async function buildProductManagerContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const agentFindings = await prisma.auditLog.findMany({
    where: { createdAt: { gte: since }, action: { startsWith: 'agent.run.' } },
    select: { action: true, details: true, createdAt: true },
    take: 30,
  }).catch(() => []);
  return { windowDays: 7, agentFindings };
}

async function buildProjectManagerContext(prisma: PrismaClient) {
  const openEscalations = await prisma.claimRecoveryAction.count({
    where: { actionType: 'HUMAN_ESCALATION', clearedAt: null },
  }).catch(() => 0);
  return { openEscalations, checkType: 'weekly sprint alignment' };
}

async function buildMarketIntelContext(_prisma: PrismaClient) {
  return {
    market: 'Canadian dental AR collections',
    carriers: ['Sun Life', 'Canada Life', 'Manulife', 'Green Shield', 'RBC Insurance', 'TELUS AdjudiCare'],
    focus: 'carrier policy changes, AR automation trends, regulatory updates',
  };
}

async function buildResearcherContext(_prisma: PrismaClient) {
  return {
    researchFocus: 'CRTC ADAD rules, PHIPA amendments, dental billing automation competitors',
    recencyTarget: 'last 30 days',
  };
}

async function buildCompetitiveIntelContext(_prisma: PrismaClient) {
  return {
    competitors: ['Claimocity', 'Dentrix Ascend', 'Curve Dental', 'NexHealth', 'Bento'],
    focus: 'Canadian dental AR automation, pricing, new feature releases',
  };
}

async function buildVoiceOfCustomerContext(prisma: PrismaClient) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const practices = await prisma.practice.findMany({
    select: { id: true, name: true, billingTier: true },
  }).catch(() => []);
  const escalationCount = await prisma.claimRecoveryAction.count({
    where: { actionType: 'HUMAN_ESCALATION', createdAt: { gte: since } },
  }).catch(() => 0);
  return { practices, escalationCount, windowDays: 30 };
}

async function buildClientAcquisitionContext(prisma: PrismaClient) {
  const practices = await prisma.practice.findMany({
    select: { id: true, name: true, billingTier: true },
    orderBy: { name: 'asc' },
    take: 10,
  }).catch(() => []);
  return { recentPractices: practices, targetICP: 'Canadian dental practices 3–15 chairs' };
}

// ── Scheduled agent registry ───────────────────────────────────────────────────

const SCHEDULED_AGENTS: ScheduledAgent[] = [
  // Daily 05:00
  { name: 'analytics-pipeline',          cron: '0 5 * * *',   buildContext: buildAnalyticsPipelineContext },
  { name: 'database-health',             cron: '0 5 * * *',   buildContext: buildDatabaseHealthContext },
  // Daily 06:00
  { name: 'carrier-ivr-health',          cron: '0 6 * * *',   buildContext: buildCarrierIvrContext },
  { name: 'tier-billing-health',         cron: '0 6 * * *',   buildContext: buildTierBillingContext },
  // Daily 07:00
  { name: 'hallucination-detector',      cron: '0 7 * * *',   buildContext: buildHallucinationContext },
  { name: 'phi-access-log-reviewer',     cron: '0 7 * * *',   buildContext: buildPhiAccessLogContext },
  // Daily 08:00
  { name: 'call-quality-scorer',         cron: '0 8 * * *',   buildContext: buildCallQualityContext },
  { name: 'risk-radar',                  cron: '0 8 * * *',   buildContext: buildRiskRadarContext },
  // Daily 09:00
  { name: 'collections-performance',     cron: '0 9 * * *',   buildContext: buildCollectionsContext },
  { name: 'escalation-triage',           cron: '0 9 * * *',   buildContext: buildEscalationTriageContext },

  // Weekly Monday
  { name: 'compliance-checker',          cron: '0 8 * * 1',   buildContext: buildComplianceContext },
  { name: 'frontend-auditor',            cron: '0 9 * * 1',   buildContext: buildFrontendAuditContext },
  { name: 'vapi-squad-auditor',          cron: '0 9 * * 1',   buildContext: buildVapiSquadContext },
  { name: 'practice-time-savings',       cron: '0 9 * * 1',   buildContext: buildTimeSavingsContext },
  { name: 'roi-proof',                   cron: '0 10 * * 1',  buildContext: buildWeeklyRoiContext },
  { name: 'security-auditor',            cron: '0 10 * * 1',  buildContext: buildSecurityAuditContext },
  { name: 'voice-agent-trainer',         cron: '0 10 * * 1',  buildContext: buildVoiceAgentTrainerContext },
  { name: 'product-manager',             cron: '0 11 * * 1',  buildContext: buildProductManagerContext },
  { name: 'project-manager',             cron: '0 11 * * 1',  buildContext: buildProjectManagerContext },

  // Weekly Tuesday
  { name: 'market-intelligence',         cron: '0 10 * * 2',  buildContext: buildMarketIntelContext },
  { name: 'client-acquisition',          cron: '0 10 * * 2',  buildContext: buildClientAcquisitionContext },
  // Weekly Wednesday
  { name: 'researcher',                  cron: '0 10 * * 3',  buildContext: buildResearcherContext },
  // Weekly Thursday
  { name: 'competitive-intelligence',    cron: '0 10 * * 4',  buildContext: buildCompetitiveIntelContext },
  // Weekly Friday
  { name: 'voice-of-customer',           cron: '0 10 * * 5',  buildContext: buildVoiceOfCustomerContext },
];

// ── Scheduler boot ────────────────────────────────────────────────────────────

function isAgentSystemEnabled(): boolean {
  // Disabled by default — set AGENTS_ENABLED=true in the host env to activate
  return ['1', 'true', 'yes'].includes(
    String(process.env.AGENTS_ENABLED ?? '').toLowerCase(),
  );
}

// Monday 07:00 ET — before the practice's day starts, after the weekend's data settles.
const WEEKLY_PILOT_REPORT_CRON = '0 7 * * 1';

function registerWeeklyPilotReport(prisma: PrismaClient): void {
  if (!weeklyPilotReportEnabled()) {
    console.warn('[ScheduledAgents] WEEKLY_PILOT_REPORT_ENABLED is not set — weekly report cron skipped');
    return;
  }
  cron.schedule(WEEKLY_PILOT_REPORT_CRON, () => {
    sendWeeklyPilotReports(prisma)
      .then((r) => {
        console.warn(
          `[ScheduledAgents] weekly pilot report: ${r.sent} sent, ${r.skippedNoOwner} skipped (no owner), ${r.failed} failed`,
        );
      })
      .catch((err) => {
        console.error('[ScheduledAgents] weekly pilot report run failed:', err);
      });
  });
}

export function startScheduledAgents(prisma: PrismaClient): void {
  registerWeeklyPilotReport(prisma);

  if (!isAgentSystemEnabled()) {
    console.log('[ScheduledAgents] AGENTS_ENABLED is not set — skipping cron registration');
    return;
  }

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.warn('[ScheduledAgents] GEMINI_API_KEY not set — agents will fail at runtime');
  }

  let registered = 0;
  for (const agent of SCHEDULED_AGENTS) {
    if (!cron.validate(agent.cron)) {
      console.error(`[ScheduledAgents] invalid cron "${agent.cron}" for ${agent.name} — skipped`);
      continue;
    }
    cron.schedule(agent.cron, () => {
      agent
        .buildContext(prisma)
        .then((ctx) => runAgent(agent.name, ctx, prisma))
        .catch((err) => {
          console.error(`[ScheduledAgents] ${agent.name} failed:`, err);
        });
    });
    registered++;
  }

  console.log(`[ScheduledAgents] registered ${registered} autonomous agents`);
}
