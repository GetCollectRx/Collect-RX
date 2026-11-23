/**
 * Stateful world for scenarios that need the queue tick, a route or the webhook:
 * synthetic practices with staff presence, a CSV import through the real PMS
 * pipeline, the real queue tick against a stubbed Vapi, and teardown that deletes
 * every row it created and then sweeps the whole database for residue.
 *
 * The mechanics mirror tests/sim-harness/officeDay.e2e.test.ts. They are copied,
 * not shared, because that file is private and under edit elsewhere.
 * Level S: the real pipeline and routes, a stubbed Vapi, no network.
 */
import { createHmac, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../../src/lib/prisma.js';
import { piiVault } from '../../../src/pii-vault.js';
import { parseSimpleCsv } from '../../../src/server/csv/parseSimple.js';
import { runPmsImportPipeline } from '../../../src/server/pms/pmsImportPipeline.js';
import { runDeskQueueTick } from '../../../src/server/frontDesk/queueEngine.js';
import vapiWebhookRouter from '../../../src/webhooks/vapi.js';
import insuranceRouter from '../../../src/routes/insurance.js';
import { authenticate } from '../../../src/server/middleware/authenticate.js';
import { signUserToken } from '../../../src/server/authToken.js';
import { defaultPracticeSettings } from '../../../src/server/services/practiceSettingsService.js';
import type { OutboundInterceptor, InterceptedRequest } from '../../sim-harness/outboundInterceptor.js';
import { officeRow, toOfficeCsv, type OfficeRow, type RowOptions } from '../../sim-harness/officeFixtures.js';

const ESCALATION_PHONE = '+16135550150';

const ENV_OVERRIDES: Record<string, string | undefined> = {
  PHI_ENCRYPTION_KEY: '33'.repeat(32),
  VAPI_API_KEY: 'sim-harness-placeholder-not-a-key',
  VAPI_PHONE_NUMBER_ID: 'sim-harness-phone-number-id',
  VAPI_SQUAD_ID: 'sim-autonomous-squad',
  VAPI_HUMAN_ASSISTED_SQUAD_ID: 'sim-hold-sentinel-squad',
  COLLECTRX_FORCE_CALL_WINDOW: '1',
  ANTHROPIC_API_KEY: 'sim-harness-placeholder-not-a-key',
  COLLECTRX_ANTHROPIC_EVAL: '1',
  JWT_SECRET: 'sim-harness-validation-lab-jwt-placeholder',
  SENDGRID_API_KEY: undefined,
  TWILIO_ACCOUNT_SID: undefined,
  TWILIO_AUTH_TOKEN: undefined,
  AGENTS_ENABLED: undefined,
};

export interface Office {
  id: string;
  staffId: string;
  token: string;
  ownerToken: string;
}

export interface OfficeOptions {
  label: string;
  voiceAgentEnabled?: boolean;
}

export interface TickResult {
  dials: InterceptedRequest[];
  claimIds: string[];
}

function claimIdOf(req: InterceptedRequest): string {
  const body = req.body as { assistantOverrides?: { metadata?: { claimId?: unknown } } } | null;
  const id = body?.assistantOverrides?.metadata?.claimId;
  return typeof id === 'string' ? id : '';
}

export class StatefulWorld {
  readonly plain = new PrismaClient();
  readonly practiceIds: string[] = [];
  private readonly phiValues: string[] = [];
  private readonly issuedTokens: string[] = [];
  private readonly saved = new Map<string, string | undefined>();
  private readonly webhookApp = express();
  private readonly insuranceApp = express();

  constructor(private readonly interceptor: OutboundInterceptor) {
    this.webhookApp.use('/api/webhooks/vapi', express.raw({ type: 'application/json' }), vapiWebhookRouter);
    this.insuranceApp.use(express.json());
    this.insuranceApp.use('/api/insurance', authenticate, insuranceRouter);
  }

  async connect(): Promise<void> {
    await this.plain.$connect();
    for (const [key, value] of Object.entries(ENV_OVERRIDES)) {
      this.saved.set(key, process.env[key]);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  setEnv(key: string, value: string | undefined): void {
    if (!this.saved.has(key)) this.saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  restoreEnv(): void {
    for (const [key, value] of this.saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  async makeOffice(opts: OfficeOptions): Promise<Office> {
    const id = randomUUID();
    const staffId = randomUUID();
    const defaults = defaultPracticeSettings();
    await this.plain.practice.create({
      data: {
        id,
        name: `SYNTHETIC ONLY ${opts.label}`,
        timezone: 'America/Toronto',
        passwordHash: 'synthetic-test-password-hash',
        billingPhone: '+16135550101',
        faxNumber: '+16135550102',
        practiceAddress: '1 Synthetic Way, Ottawa ON',
        npi: `99${id.replace(/\D/gu, '').padEnd(8, '0').slice(0, 8)}`,
        billingTier: 'sentinel',
        subscriptionStatus: 'active',
        settings: JSON.parse(JSON.stringify({
          ...defaults,
          escalationPhoneNumber: ESCALATION_PHONE,
          humanAssistedMode: true,
          voiceAgentEnabled: opts.voiceAgentEnabled ?? true,
          carrierConfigs: defaults.carrierConfigs.map((c) => ({
            ...c,
            authorizationSubmitted: true,
            authorizationSubmittedAt: new Date().toISOString(),
            providerNumber: 'SYN-PROV-0001',
          })),
        })) as object,
      },
    });
    await this.plain.user.create({
      data: {
        id: staffId,
        practiceId: id,
        email: `front-desk-${id.slice(0, 8)}@collectrx-test.local`,
        passwordHash: 'synthetic-test-password-hash',
        role: 'front_desk',
        displayName: 'Synthetic front desk',
      },
    });
    await this.plain.staffPresence.create({ data: { practiceId: id, userId: staffId, status: 'AVAILABLE' } });
    this.practiceIds.push(id);
    return {
      id,
      staffId,
      token: signUserToken({ userId: staffId, practiceId: id, role: 'front_desk' }),
      ownerToken: signUserToken({ userId: staffId, practiceId: id, role: 'practice_owner' }),
    };
  }

  /** Imports synthetic rows through the real PMS pipeline and returns the new claim ids in row order. */
  async importRows(practiceId: string, specs: Array<{ tag: string; opts?: RowOptions }>): Promise<string[]> {
    const rows: OfficeRow[] = specs.map((s) => officeRow(s.tag, s.opts ?? {}));
    for (const r of rows) {
      for (const v of [`${r.patient_first_name} ${r.patient_last_name}`, r.subscriber_id, r.group_policy_number]) {
        if (v.trim().length >= 6) this.phiValues.push(v);
      }
    }
    await runPmsImportPipeline(this.plain, { practiceId, pmsSource: 'other', rows: parseSimpleCsv(toOfficeCsv(rows)) });
    const claims = await this.plain.insuranceClaim.findMany({ where: { practiceId }, select: { id: true, claimNumber: true, patientToken: true } });
    this.issuedTokens.push(...claims.map((c) => c.patientToken));
    return rows.map((r) => claims.find((c) => c.claimNumber === r.claim_number)?.id ?? '');
  }

  /** The tick works every practice in the database, so park the others before it runs. */
  async tickFor(practiceId: string, tickCount = 1): Promise<TickResult> {
    await this.plain.callQueue.updateMany({
      where: { practiceId: { in: this.practiceIds.filter((id) => id !== practiceId) }, status: { in: ['PENDING', 'IN_PROGRESS', 'BLOCKED'] } },
      data: { status: 'COMPLETED' },
    });
    const before = this.interceptor.dials().length;
    const runs: Array<Promise<void>> = [];
    for (let i = 0; i < tickCount; i += 1) runs.push(runDeskQueueTick(prisma));
    await Promise.all(runs);
    const dials = this.interceptor.dials().slice(before);
    return { dials, claimIds: dials.map(claimIdOf) };
  }

  async freeLines(practiceId: string): Promise<void> {
    await this.plain.callAttempt.updateMany({ where: { completedAt: null, claim: { practiceId } }, data: { completedAt: new Date() } });
  }

  expireToken(claimToken: string): void {
    piiVault.expireToken(claimToken, 'validation-lab-teardown');
  }

  async trigger(claimId: string, token: string): Promise<{ status: number; code: string | null; error: string | null }> {
    const res = await request(this.insuranceApp)
      .post(`/api/insurance/queue/trigger/${claimId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const body = res.body as { code?: unknown; error?: unknown };
    return { status: res.status, code: typeof body.code === 'string' ? body.code : null, error: typeof body.error === 'string' ? body.error.slice(0, 80) : null };
  }

  async postWebhook(envelope: Record<string, unknown>): Promise<{ status: number }> {
    const raw = JSON.stringify(envelope);
    const secret = process.env.VAPI_WEBHOOK_SECRET ?? '';
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    const res = await request(this.webhookApp).post('/api/webhooks/vapi').set('Content-Type', 'application/json').set('x-vapi-signature', signature).send(raw);
    return { status: res.status };
  }

  private async sweep(values: string[]): Promise<number> {
    if (values.length === 0) return 0;
    const tables = await this.plain.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    const patterns = values.map((v) => `%${v.replace(/[%_\\]/gu, (m) => `\\${m}`)}%`);
    let hits = 0;
    for (const { table_name: table } of tables) {
      const rows = await this.plain.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM "${table.replace(/"/gu, '')}" x WHERE x::text ILIKE ANY($1::text[])`,
        patterns,
      );
      hits += rows[0]?.n ?? 0;
    }
    return hits;
  }

  /** Deletes every row that references the run, then returns how many rows still mention a marker or synthetic value. */
  async teardown(): Promise<number> {
    for (const token of this.issuedTokens) piiVault.expireToken(token, 'validation-lab-teardown');
    const claims = await this.plain.insuranceClaim.findMany({ where: { practiceId: { in: this.practiceIds } }, select: { id: true } });
    const attempts = await this.plain.callAttempt.findMany({ where: { claim: { practiceId: { in: this.practiceIds } } }, select: { id: true, vapiCallId: true } });
    const markers = [...this.practiceIds, ...claims.map((c) => c.id), ...attempts.map((a) => a.id), ...attempts.map((a) => a.vapiCallId)];
    if (markers.length > 0) {
      const tables = await this.plain.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
      const patterns = markers.map((m) => `%${m}%`);
      for (let pass = 0; pass < 12; pass += 1) {
        let deleted = 0;
        for (const { table_name: table } of tables) {
          try {
            deleted += await this.plain.$executeRawUnsafe(`DELETE FROM "${table.replace(/"/gu, '')}" x WHERE x::text LIKE ANY($1::text[])`, patterns);
          } catch {
            // A foreign key still points at this row; a later pass removes it.
          }
        }
        if (deleted === 0) break;
      }
      await this.plain.$executeRaw`DELETE FROM queue_engine_lease`;
    }
    const residue = await this.sweep([...markers, ...this.phiValues]);
    await this.plain.$disconnect();
    this.restoreEnv();
    return residue;
  }
}
