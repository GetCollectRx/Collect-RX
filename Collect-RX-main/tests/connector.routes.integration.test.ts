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
