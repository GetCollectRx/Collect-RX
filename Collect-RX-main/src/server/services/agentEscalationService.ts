import type { PrismaClient, Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';
import { logger } from '../observability/logger.js';

export interface AgentFinding {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  domain: string;
  description: string;
  action: string;
  evidence?: string | null;
}

export interface AgentRunInput {
  agentName: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK';
  score?: number | null;
  summary: string;
  findings: AgentFinding[];
  downstream: string[];
  raw?: Record<string, unknown> | null;
}

const KHALID_EMAIL = 'khalidegeh97@gmail.com';

async function sendEmail(subject: string, body: string): Promise<void> {
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) return;

  const transport = nodemailer.createTransport(smtpUrl);
  await transport.sendMail({
    from: 'CollectRx Agents <noreply@collectrx.ca>',
    to: KHALID_EMAIL,
    subject,
    text: body,
  });
}

function buildCriticalNotificationText(agentName: string, finding: AgentFinding, runId: string): string {
  return [
    `🔴 CRITICAL — CollectRx Agent Alert`,
    `Agent:    ${agentName}`,
    `Finding:  ${finding.description}`,
    `Domain:   ${finding.domain}`,
    `Action:   ${finding.action}`,
    finding.evidence ? `Evidence: ${finding.evidence}` : null,
    `Run ID:   ${runId}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function recordAgentRun(
  prisma: PrismaClient,
  input: AgentRunInput,
): Promise<{ id: string; escalated: boolean }> {
  const criticalFindings = input.findings.filter(f => f.severity === 'CRITICAL');
  const escalated = criticalFindings.length > 0;

  const run = await prisma.agentRun.create({
    data: {
      agentName: input.agentName,
      severity: input.severity,
      score: input.score ?? null,
      summary: input.summary,
      findings: input.findings as unknown as object,
      downstream: input.downstream,
      escalated,
      raw: (input.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  if (escalated) {
    const subject = `🔴 CRITICAL — CollectRx: ${input.agentName} — ${criticalFindings.length} finding(s)`;
    const lines = criticalFindings.map(f => buildCriticalNotificationText(input.agentName, f, run.id));
    await sendEmail(subject, lines.join('\n\n---\n\n')).catch(err =>
      logger.error('[agentEscalation] email failed', { error: err }),
    );
  }

  return { id: run.id, escalated };
}

export async function getLatestAgentRun(prisma: PrismaClient, agentName: string) {
  return prisma.agentRun.findFirst({
    where: { agentName },
    orderBy: { runAt: 'desc' },
  });
}

export async function getPreviousRunsForDownstream(
  prisma: PrismaClient,
  agentNames: string[],
  sinceHours = 48,
): Promise<Record<string, unknown>> {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const runs = await prisma.agentRun.findMany({
    where: { agentName: { in: agentNames }, runAt: { gte: since } },
    orderBy: { runAt: 'desc' },
  });

  const byAgent: Record<string, unknown> = {};
  for (const run of runs) {
    if (!byAgent[run.agentName]) byAgent[run.agentName] = run;
  }
  return byAgent;
}
