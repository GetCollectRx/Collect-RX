/**
 * Human-approval gate for the outreach pipeline's Approval Agent
 * (agents/outreach/approval-agent.md, OUTREACH_REQUIRE_HUMAN_APPROVAL). A
 * contact held with pendingOutreachApproval=true must never be picked up by
 * sequenceEngine.ts (covered separately in tests/marketing/sequenceEngine.test.ts)
 * and must become send-eligible again only once the operator approves it here.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';

const DEV_PW = process.env.PLATFORM_DEV_PASSWORD || 'collectrx-dev-platform-only';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[prospectOutreachApproval] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function extractCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  const match = raw.match(/crx_access=[^;]+/);
  return match?.[0] ?? '';
}

async function platformDevCookie(): Promise<string> {
  const prev = process.env.PLATFORM_DEV_PASSWORD;
  process.env.PLATFORM_DEV_PASSWORD = DEV_PW;
  const login = await request(app).post('/api/auth/login/platform-dev').send({ password: DEV_PW });
  process.env.PLATFORM_DEV_PASSWORD = prev;
  return extractCookie(login);
}

async function createHeldProspect(): Promise<{ id: string }> {
  return prisma.prospect.create({
    data: {
      practiceName: `Fixture Dental ${Date.now()}`,
      email: `prospect-${randomUUID()}@fixture.test`,
      pendingOutreachApproval: true,
    },
    select: { id: true },
  });
}

describe.skipIf(!dbReady)('POST /api/admin/partnerships/prospects/outreach-review', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/admin/partnerships/prospects/outreach-review')
      .send({ approve: ['does-not-matter'] });
    expect(res.status).toBe(401);
  });

  it('approving clears pendingOutreachApproval and makes the contact filterable as no longer pending', async () => {
    const cookie = await platformDevCookie();
    const prospect = await createHeldProspect();
    try {
      const post = await request(app)
        .post('/api/admin/partnerships/prospects/outreach-review')
        .set('Cookie', cookie)
        .send({ approve: [prospect.id] });
      expect(post.status).toBe(200);
      expect(post.body.data.approved).toBe(1);

      const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
      expect(updated.pendingOutreachApproval).toBe(false);

      const activity = await prisma.prospectActivity.findFirst({
        where: { prospectId: prospect.id, type: 'outreach_approved' },
      });
      expect(activity).not.toBeNull();

      const stillPending = await request(app)
        .get('/api/admin/partnerships/prospects?pendingOutreachApproval=true')
        .set('Cookie', cookie);
      const ids = (stillPending.body.data as { id: string }[]).map((p) => p.id);
      expect(ids).not.toContain(prospect.id);
    } finally {
      await prisma.prospectActivity.deleteMany({ where: { prospectId: prospect.id } });
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });

  it('rejecting clears pendingOutreachApproval but routes the contact to closed_lost so it never sends', async () => {
    const cookie = await platformDevCookie();
    const prospect = await createHeldProspect();
    try {
      const post = await request(app)
        .post('/api/admin/partnerships/prospects/outreach-review')
        .set('Cookie', cookie)
        .send({ reject: [prospect.id] });
      expect(post.status).toBe(200);
      expect(post.body.data.rejected).toBe(1);

      const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
      expect(updated.pendingOutreachApproval).toBe(false);
      expect(updated.stage).toBe('closed_lost');

      const activity = await prisma.prospectActivity.findFirst({
        where: { prospectId: prospect.id, type: 'outreach_rejected' },
      });
      expect(activity).not.toBeNull();
    } finally {
      await prisma.prospectActivity.deleteMany({ where: { prospectId: prospect.id } });
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });

  it('rejects an empty request with 400', async () => {
    const cookie = await platformDevCookie();
    const res = await request(app)
      .post('/api/admin/partnerships/prospects/outreach-review')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!dbReady)('PATCH /api/admin/partnerships/prospects/:id (pendingOutreachApproval)', () => {
  it('holds a gate-cleared contact for review and logs the hold', async () => {
    const cookie = await platformDevCookie();
    const prospect = await prisma.prospect.create({
      data: { practiceName: `Fixture Dental ${Date.now()}`, email: `prospect-${randomUUID()}@fixture.test` },
      select: { id: true },
    });
    try {
      const patch = await request(app)
        .patch(`/api/admin/partnerships/prospects/${prospect.id}`)
        .set('Cookie', cookie)
        .send({ pendingOutreachApproval: true });
      expect(patch.status).toBe(200);
      expect(patch.body.data.pendingOutreachApproval).toBe(true);

      const activity = await prisma.prospectActivity.findFirst({
        where: { prospectId: prospect.id, type: 'outreach_approval_held' },
      });
      expect(activity).not.toBeNull();
    } finally {
      await prisma.prospectActivity.deleteMany({ where: { prospectId: prospect.id } });
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });
});
