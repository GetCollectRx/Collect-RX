/**
 * HTTP integration tests for /api/connector/* (desktop agent auth).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { createPracticeForTests, cleanupPracticeWithUsers } from './factories/practice.js';
import {
  mintConnectorAgent,
  revokeConnectorAgent,
} from '../src/server/services/desktopConnectorService.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[connector.routes.integration] DATABASE_URL unreachable — tests skipped:',
    (e as Error).message,
  );
}

describe.skipIf(!dbReady)('Connector routes (integration)', () => {
  let practiceId: string;
  let token: string;
  let agentId: string;

  beforeAll(async () => {
    const practice = await createPracticeForTests(prisma);
    practiceId = practice.id;
    const minted = await mintConnectorAgent(practiceId, 'integration-test-agent');
    token = minted.token;
    agentId = minted.agent.id;
  });

  afterAll(async () => {
    await prisma.pmsWritebackLog.deleteMany({ where: { practiceId } });
    await prisma.desktopConnectorAgent.deleteMany({ where: { practiceId } });
    await cleanupPracticeWithUsers(prisma, practiceId);
    await prisma.$disconnect().catch(() => undefined);
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('POST /api/connector/heartbeat returns 401 without token', async () => {
    const res = await request(app).post('/api/connector/heartbeat').send({ status: 'ok' });
    expect(res.status).toBe(401);
  });

  it('POST /api/connector/heartbeat records liveness', async () => {
    const res = await request(app)
      .post('/api/connector/heartbeat')
      .set(auth())
      .send({
        status: 'ok',
        version: '1.0.0-pilot',
        hostname: 'test-pc',
        platform: 'win32',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const agent = await prisma.desktopConnectorAgent.findUnique({ where: { id: agentId } });
    expect(agent?.lastHeartbeatAt).toBeTruthy();
    expect(agent?.hostname).toBe('test-pc');
  });

  it('POST /api/connector/claims/import rejects non-array body', async () => {
    const res = await request(app)
      .post('/api/connector/claims/import')
      .set(auth())
      .send({ records: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('POST /api/connector/claims/import accepts empty batch', async () => {
    const res = await request(app)
      .post('/api/connector/claims/import')
      .set(auth())
      .send({ records: [], pmsVendor: 'abeldent' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.imported).toBe(0);
  });

  it('POST /api/connector/claims/import-file returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/connector/claims/import-file')
      .attach('file', Buffer.from('claim_number\nX-1'), 'export.csv');
    expect(res.status).toBe(401);
  });

  it('POST /api/connector/claims/import-file rejects a non-CSV file', async () => {
    const res = await request(app)
      .post('/api/connector/claims/import-file')
      .set(auth())
      .attach('file', Buffer.from('not a csv'), 'export.png');
    expect(res.status).toBe(400);
  });

  it('POST /api/connector/claims/import-file rejects an unknown pmsVendor', async () => {
    const csv = 'claim_number,carrier_name,amount_outstanding\nCLM-FW-1,Sun Life,100\n';
    const res = await request(app)
      .post('/api/connector/claims/import-file')
      .set(auth())
      .field('pmsVendor', 'not_a_real_vendor')
      .attach('file', Buffer.from(csv), 'export.csv');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown PMS vendor/);
  });

  it('POST /api/connector/claims/import-file parses and imports a CSV export — the folder-watcher\'s upload path', async () => {
    const csv = [
      'claim_number,patient_first_name,patient_last_name,carrier_name,treatment_date,amount_billed,amount_outstanding,days_outstanding',
      'CLM-FW-1001,Priya,Nair,Sun Life,2026-02-01,180.00,180.00,35',
    ].join('\n');

    const res = await request(app)
      .post('/api/connector/claims/import-file')
      .set(auth())
      .field('pmsVendor', 'other')
      .attach('file', Buffer.from(csv), 'export.csv');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.imported).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(typeof res.body.contentHash).toBe('string');
    expect(res.body.contentHash).toHaveLength(64); // sha256 hex

    const claim = await prisma.insuranceClaim.findUnique({
      where: { practiceId_claimNumber: { practiceId, claimNumber: 'CLM-FW-1001' } },
    });
    expect(claim).toBeTruthy();
    expect(Number(claim!.outstandingAmount)).toBe(180);

    // Re-uploading identical bytes is a safe no-op via the same upsert path the JSON
    // route uses — not a duplicate row, and the reported hash matches (dedupe-friendly
    // for the local watcher's ledger, which keys on this exact value).
    const replay = await request(app)
      .post('/api/connector/claims/import-file')
      .set(auth())
      .field('pmsVendor', 'other')
      .attach('file', Buffer.from(csv), 'export.csv');
    expect(replay.status).toBe(200);
    expect(replay.body.contentHash).toBe(res.body.contentHash);
    const stillOne = await prisma.insuranceClaim.findMany({
      where: { practiceId, claimNumber: 'CLM-FW-1001' },
    });
    expect(stillOne).toHaveLength(1);

    await prisma.insuranceClaim.deleteMany({ where: { practiceId, claimNumber: 'CLM-FW-1001' } });
    await prisma.pmsImportRun.deleteMany({ where: { practiceId } });
  });

  it('GET /api/connector/writeback-pending returns entries array', async () => {
    const res = await request(app).get('/api/connector/writeback-pending').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it('POST /api/connector/writeback-ack updates log row', async () => {
    const row = await prisma.pmsWritebackLog.create({
      data: {
        practiceId,
        source: 'collectrx',
        claimRef: 'fixture-claim-001',
        payload: { note: 'test' },
      },
    });

    const res = await request(app)
      .post('/api/connector/writeback-ack')
      .set(auth())
      .send({ id: row.id, ok: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await prisma.pmsWritebackLog.findUnique({ where: { id: row.id } });
    expect(updated?.processedAt).toBeTruthy();
  });

  it('returns 401 after token revoked', async () => {
    const revoked = await revokeConnectorAgent(agentId, practiceId);
    expect(revoked).toBe(true);

    const res = await request(app).post('/api/connector/heartbeat').set(auth()).send({ status: 'ok' });
    expect(res.status).toBe(401);
  });
});
