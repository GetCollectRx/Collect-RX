import { Router } from 'express';
import { z } from 'zod';
import { getPrisma } from '../db';
import {
  recordAgentRun,
  getLatestAgentRun,
  getPreviousRunsForDownstream,
  type AgentRunInput,
} from '../services/agentEscalationService';

const router = Router();

const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  domain: z.string(),
  description: z.string(),
  action: z.string(),
  evidence: z.string().nullable().optional(),
});

const AgentRunInputSchema = z.object({
  agentName: z.string().min(1),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'OK']),
  score: z.number().int().min(0).max(100).nullable().optional(),
  summary: z.string().min(1),
  findings: z.array(FindingSchema),
  downstream: z.array(z.string()),
  raw: z.record(z.string(), z.unknown()).nullable().optional(),
});

function requireAgentSecret(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  const secret = process.env.AGENT_RUNTIME_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'AGENT_RUNTIME_SECRET not configured' });
    }
    return next();
  }
  const auth = req.headers['authorization'] ?? '';
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/agent-runs — record a completed agent run, fire escalation if needed
router.post('/', requireAgentSecret, async (req, res) => {
  const parsed = AgentRunInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  }

  const prisma = getPrisma();
  const result = await recordAgentRun(prisma, parsed.data as AgentRunInput);
  res.status(201).json(result);
});

// GET /api/agent-runs/latest/:agentName — fetch most recent run for an agent
router.get('/latest/:agentName', requireAgentSecret, async (req, res) => {
  const prisma = getPrisma();
  const run = await getLatestAgentRun(prisma, req.params.agentName);
  if (!run) return res.status(404).json({ error: 'No runs found' });
  res.json(run);
});

// GET /api/agent-runs/context?agents=a,b,c&hours=48 — fetch latest runs for a set of upstream agents
router.get('/context', requireAgentSecret, async (req, res) => {
  const agentNames = String(req.query.agents ?? '').split(',').filter(Boolean);
  const hours = Number(req.query.hours ?? 48);
  if (!agentNames.length) return res.status(400).json({ error: 'agents param required' });
  const prisma = getPrisma();
  const context = await getPreviousRunsForDownstream(prisma, agentNames, hours);
  res.json(context);
});

// GET /api/agent-runs/digest — HIGH+ findings from last 24 hours for morning digest
router.get('/digest', requireAgentSecret, async (_req, res) => {
  const prisma = getPrisma();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const runs = await prisma.agentRun.findMany({
    where: { runAt: { gte: since }, severity: { in: ['CRITICAL', 'HIGH'] } },
    orderBy: [{ severity: 'asc' }, { runAt: 'desc' }],
  });
  res.json(runs);
});

export default router;
