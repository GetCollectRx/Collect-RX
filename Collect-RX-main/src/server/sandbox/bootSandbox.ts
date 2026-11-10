/**
 * Sandbox start-up, run once the database and PHI vault are ready:
 *  1. A one-time database reset, only when SANDBOX_RESET_TOKEN is set to a
 *     value not used before, and only on the collect-rx-staging app (or a
 *     non-production local run).
 *  2. The two synthetic practices, their logins and claims.
 *  3. Calls that were in progress when the process last stopped resume.
 *  4. Finished calls are scored against their registry scenario.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { runWithRlsBypass } from '../db/rlsContext.js';
import { logger } from '../observability/logger.js';
import { getHumanAssistedSquadId } from '../../vapi/client.js';
import { carrierSimulator, type CarrierSimulator } from './carrierSimulator.js';
import { registerScenarioScoring } from './scenarioScoring.js';
import { ensurePracticeRecord, ensureSandboxPractice, SANDBOX_PRACTICES } from './syntheticPractices.js';
import { buildCallPlan } from './callPlan.js';
import { findCallScenario, scenarioIdFromClaimNumber } from './scenarioRegistry.js';

const STAGING_APP = 'collect-rx-staging';

export function resetAllowedHere(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FLY_APP_NAME) return env.FLY_APP_NAME === STAGING_APP;
  return env.NODE_ENV !== 'production';
}

function settingsRecord(v: Prisma.JsonValue | null): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Deletes every row in every application table, in as many passes as foreign keys need. */
async function wipeDatabase(prisma: PrismaClient): Promise<{ residualTables: string[] }> {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
  for (let pass = 0; pass < 15; pass += 1) {
    let remaining = 0;
    for (const { table_name: table } of tables) {
      const safe = table.replace(/"/gu, '');
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${safe}"`);
      } catch {
        remaining += 1;
      }
    }
    if (remaining === 0) return { residualTables: [] };
  }
  const residual: string[] = [];
  for (const { table_name: table } of tables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "${table.replace(/"/gu, '')}"`);
    if ((rows[0]?.n ?? 0n) > 0n) residual.push(table);
  }
  return { residualTables: residual };
}

async function maybeReset(prisma: PrismaClient): Promise<void> {
  const token = process.env.SANDBOX_RESET_TOKEN?.trim();
  if (!token) return;
  if (!resetAllowedHere()) {
    logger.error('[sandbox] SANDBOX_RESET_TOKEN ignored: reset is only allowed on the staging app', { app: process.env.FLY_APP_NAME ?? 'local' });
    return;
  }
  const marker = SANDBOX_PRACTICES[0];
  if (!marker) return;
  const practice = await prisma.practice.findUnique({ where: { id: marker.id }, select: { settings: true } });
  if (settingsRecord(practice?.settings ?? null).sandboxResetToken === token) return;
  logger.warn('[sandbox] resetting the staging database to synthetic data (new SANDBOX_RESET_TOKEN)', {});
  const { residualTables } = await wipeDatabase(prisma);
  if (residualTables.length > 0) logger.warn('[sandbox] reset left rows in tables that refuse deletes', { tables: residualTables });
  // Only the practice record, so the marker is saved before any claim is
  // imported: a failed import is retried without wiping the database again.
  await ensurePracticeRecord(prisma, marker);
  const after = await prisma.practice.findUnique({ where: { id: marker.id }, select: { settings: true } });
  await prisma.practice.update({
    where: { id: marker.id },
    data: { settings: { ...settingsRecord(after?.settings ?? null), sandboxResetToken: token } as Prisma.InputJsonValue },
  });
}

/** Re-attaches the simulator to calls that were live when the process stopped. */
export async function resumeOpenCalls(prisma: PrismaClient, sim: CarrierSimulator = carrierSimulator): Promise<number> {
  const open = await prisma.callAttempt.findMany({
    where: { completedAt: null, vapiCallId: { startsWith: 'sbx-' } },
    select: {
      vapiCallId: true,
      initiatedAt: true,
      claim: { select: { id: true, claimNumber: true, carrierId: true, practiceId: true, patientToken: true } },
    },
  });
  const practices = await prisma.practice.findMany({
    where: { id: { in: [...new Set(open.map((a) => a.claim.practiceId))] } },
    select: { id: true, name: true, settings: true },
  });
  const byId = new Map(practices.map((p) => [p.id, p]));
  for (const a of open) {
    const practice = byId.get(a.claim.practiceId);
    const humanAssisted = settingsRecord(practice?.settings ?? null).humanAssistedMode !== false;
    const body = {
      squadId: humanAssisted ? getHumanAssistedSquadId() : process.env.VAPI_SQUAD_ID,
      assistantOverrides: {
        metadata: { claimId: a.claim.id, carrierId: a.claim.carrierId, patientToken: a.claim.patientToken, practiceId: a.claim.practiceId },
        variableValues: { claim_number: a.claim.claimNumber, insurance_carrier: a.claim.carrierId, practice_name: practice?.name ?? 'the practice' },
      },
    };
    const started = a.initiatedAt ?? new Date();
    // A Hold Sentinel call already past its handoff is assumed transferred at
    // the handoff time, since the transfer state lived only in memory.
    let afterTransferAt: Date | null = null;
    const scenario = findCallScenario(scenarioIdFromClaimNumber(a.claim.claimNumber));
    if (humanAssisted && scenario) {
      const plan = buildCallPlan({ vapiCallId: a.vapiCallId, scenario, carrierId: a.claim.carrierId, mode: 'hold_sentinel' });
      const handoff = plan.beforeHandoff.find((s) => s.kind === 'handoff');
      if (handoff && started.getTime() + handoff.at * 1000 < Date.now()) afterTransferAt = new Date(started.getTime() + (handoff.at + 5) * 1000);
    }
    sim.start(a.vapiCallId, body, { started, afterTransferAt });
  }
  return open.length;
}

export async function startSandbox(prisma: PrismaClient): Promise<void> {
  await runWithRlsBypass(async () => {
    await maybeReset(prisma);
    for (const def of SANDBOX_PRACTICES) {
      const r = await ensureSandboxPractice(prisma, def);
      logger.info('[sandbox] practice ready', { practiceId: r.practiceId, created: r.created, claimsImported: r.claimsImported });
      if (!r.loginsUsable) {
        logger.warn('[sandbox] SANDBOX_LOGIN_PASSWORD is not set (12+ characters); sandbox logins cannot sign in until it is', {});
      }
    }
    const resumed = await resumeOpenCalls(prisma);
    if (resumed > 0) logger.info('[sandbox] resumed simulated calls', { resumed });
  });
  registerScenarioScoring(prisma, carrierSimulator);
}

const START_RETRY_DELAY_MS = 30_000;
const START_MAX_ATTEMPTS = 20;

/**
 * Runs sandbox setup in the background and retries on failure. A setup error is
 * logged and retried; it does not stop the app, which stays up so the failure
 * can be seen and the sandbox finishes setting itself up when the cause clears.
 */
export function startSandboxWithRetry(prisma: PrismaClient, attempt = 1): void {
  startSandbox(prisma).then(
    () => logger.info('[sandbox] ready', { attempt }),
    (err: unknown) => {
      logger.error('[sandbox] setup failed', { attempt, error: err instanceof Error ? err.message : 'unknown' });
      if (attempt >= START_MAX_ATTEMPTS) {
        logger.error('[sandbox] giving up on setup; restart the app to try again', { attempts: attempt });
        return;
      }
      setTimeout(() => startSandboxWithRetry(prisma, attempt + 1), START_RETRY_DELAY_MS).unref();
    },
  );
}
