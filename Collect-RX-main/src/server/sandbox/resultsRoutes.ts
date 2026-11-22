/**
 * Sandbox results: the verdict for every scored call in the signed-in
 * practice, grouped by registry scenario. JSON at /api/sandbox/results and a
 * plain page at /api/sandbox/results/page. Mounted only in sandbox mode,
 * behind the normal session check, and scoped to the session's practice.
 */
import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { practiceIdFromSession } from '../middleware/requirePracticeSession.js';
import { loadRegistry, isCallScenario } from './scenarioRegistry.js';
import { SCENARIO_RESULT_ACTION } from './scenarioScoring.js';

interface ResultRow {
  scenarioId: string;
  scenarioName: string;
  tier: string;
  verdict: string;
  outcomeClass: string;
  mode: string;
  carrierId: string;
  claimNumber: string;
  failedChecks: string[];
  endedAt: string | null;
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function s(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function loadResults(prisma: PrismaClient, practiceId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { practiceId, action: SCENARIO_RESULT_ACTION },
    orderBy: { createdAt: 'desc' },
    take: 2000,
    select: { details: true },
  });
  const results: ResultRow[] = rows.map((r) => {
    const d = rec(r.details);
    const checks = Array.isArray(d.checks) ? d.checks.map(rec) : [];
    return {
      scenarioId: s(d.scenarioId),
      scenarioName: s(d.scenarioName),
      tier: s(d.tier),
      verdict: s(d.verdict),
      outcomeClass: s(d.outcomeClass),
      mode: s(d.mode),
      carrierId: s(d.carrierId),
      claimNumber: s(d.claimNumber),
      failedChecks: checks.filter((c) => c.passed === false).map((c) => `${s(c.id)}: ${s(c.detail)}`),
      endedAt: typeof d.endedAt === 'string' ? d.endedAt : null,
    };
  });
  const registry = loadRegistry();
  const callable = registry.filter(isCallScenario);
  const latest = new Map<string, ResultRow>();
  for (const r of results) if (!latest.has(r.scenarioId)) latest.set(r.scenarioId, r);
  const scored = [...latest.values()].filter((r) => r.scenarioId !== 'DEFAULT');
  return {
    summary: {
      registryScenarios: registry.length,
      playableAsCalls: callable.length,
      notCalls: registry.length - callable.length,
      scenariosScored: scored.length,
      pass: scored.filter((r) => r.verdict === 'PASS').length,
      fail: scored.filter((r) => r.verdict === 'FAIL').length,
      notYetCalled: callable.length - scored.length,
      callsScored: results.length,
    },
    latestByScenario: scored.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId)),
  };
}

function esc(v: string): string {
  return v.replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export function createSandboxResultsRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.get('/results', async (req: Request, res: Response) => {
    try {
      return res.json({ success: true, data: await loadResults(prisma, practiceIdFromSession(req)) });
    } catch {
      return res.status(500).json({ success: false, error: 'Could not load sandbox results' });
    }
  });
  router.get('/results/page', async (req: Request, res: Response) => {
    try {
      const { summary, latestByScenario } = await loadResults(prisma, practiceIdFromSession(req));
      const rows = latestByScenario
        .map((r) => `<tr class="${r.verdict === 'PASS' ? 'pass' : 'fail'}"><td>${esc(r.scenarioId)}</td><td>${esc(r.tier)}</td><td>${esc(r.scenarioName)}</td><td>${esc(r.mode)}</td><td>${esc(r.carrierId)}</td><td>${esc(r.outcomeClass)}</td><td>${esc(r.verdict)}</td><td>${esc(r.failedChecks.join('; '))}</td></tr>`)
        .join('');
      res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox results</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;color:#111}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}tr.fail td{background:#fdecec}tr.pass td{background:#eefaf0}.k{display:inline-block;margin-right:18px}</style></head><body>
<h1>Sandbox scenario results</h1>
<p><span class="k">Registry scenarios: ${summary.registryScenarios}</span><span class="k">Playable as calls: ${summary.playableAsCalls}</span><span class="k">Not calls (checks or pilot only): ${summary.notCalls}</span></p>
<p><span class="k">Scored: ${summary.scenariosScored}</span><span class="k">PASS: ${summary.pass}</span><span class="k">FAIL: ${summary.fail}</span><span class="k">Not yet called: ${summary.notYetCalled}</span></p>
<table><thead><tr><th>Scenario</th><th>Tier</th><th>Name</th><th>Mode</th><th>Carrier</th><th>Plays as</th><th>Verdict</th><th>Failed checks</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
      return undefined;
    } catch {
      return res.status(500).type('text').send('Could not load sandbox results');
    }
  });
  return router;
}
