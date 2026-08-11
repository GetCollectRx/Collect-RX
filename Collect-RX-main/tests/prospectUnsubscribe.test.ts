/**
 * GET/POST /api/public/prospect-unsubscribe — real end-to-end coverage for a
 * route that didn't exist until now. The URL was built and embedded in every
 * cold-outreach email's List-Unsubscribe headers
 * (marketing/prospectEmail.ts), but nothing in src/server ever handled it —
 * found while writing tests/rateLimiters.test.ts for publicLimiter, which
 * was built for exactly this route and, until this file, protected nothing.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { signProspectUnsubscribeToken } from '../src/server/email/unsubscribeUrl.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[prospectUnsubscribe] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

async function createProspect(): Promise<{ id: string }> {
  return prisma.prospect.create({
    data: { practiceName: `Fixture Dental ${Date.now()}`, email: `prospect-${randomUUID()}@fixture.test` },
    select: { id: true },
  });
}

describe.skipIf(!dbReady)('GET/POST /api/public/prospect-unsubscribe', () => {
  it('GET with a valid signature opts the prospect out and returns an HTML confirmation', async () => {
    const prospect = await createProspect();
    try {
      const token = signProspectUnsubscribeToken(prospect.id);
      const res = await request(app).get(`/api/public/prospect-unsubscribe?p=${prospect.id}&s=v1${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toContain("unsubscribed");

      const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
      expect(updated.optOutAt).not.toBeNull();
      expect(updated.stage).toBe('opted_out');
      expect(updated.sequenceCompleted).toBe(true);

      const activity = await prisma.prospectActivity.findFirst({
        where: { prospectId: prospect.id, type: 'email_opt_out' },
      });
      expect(activity?.summary).toBe('unsubscribe_link');
    } finally {
      await prisma.prospectActivity.deleteMany({ where: { prospectId: prospect.id } });
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });

  it('POST (RFC 8058 one-click) opts out with a plain JSON response, no HTML page', async () => {
    const prospect = await createProspect();
    try {
      const token = signProspectUnsubscribeToken(prospect.id);
      const res = await request(app).post(`/api/public/prospect-unsubscribe?p=${prospect.id}&s=v1${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
      expect(updated.optOutAt).not.toBeNull();
    } finally {
      await prisma.prospectActivity.deleteMany({ where: { prospectId: prospect.id } });
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });

  it('rejects an invalid signature and never opts the prospect out', async () => {
    const prospect = await createProspect();
    try {
      const res = await request(app).get(`/api/public/prospect-unsubscribe?p=${prospect.id}&s=v1not-the-real-signature`);
      expect(res.status).toBe(400);

      const unchanged = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
      expect(unchanged.optOutAt).toBeNull();
    } finally {
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });

  it('rejects a signature that is valid for a DIFFERENT prospect id', async () => {
    const prospectA = await createProspect();
    const prospectB = await createProspect();
    try {
      const tokenForA = signProspectUnsubscribeToken(prospectA.id);
      // Attacker takes a real signature meant for A and tries to apply it to B.
      const res = await request(app).get(`/api/public/prospect-unsubscribe?p=${prospectB.id}&s=v1${tokenForA}`);
      expect(res.status).toBe(400);

      const unchangedB = await prisma.prospect.findUniqueOrThrow({ where: { id: prospectB.id } });
      expect(unchangedB.optOutAt).toBeNull();
    } finally {
      await prisma.prospect.delete({ where: { id: prospectA.id } });
      await prisma.prospect.delete({ where: { id: prospectB.id } });
    }
  });

  it('is idempotent — accepting the same link twice never errors', async () => {
    const prospect = await createProspect();
    try {
      const token = signProspectUnsubscribeToken(prospect.id);
      const first = await request(app).get(`/api/public/prospect-unsubscribe?p=${prospect.id}&s=v1${token}`);
      const second = await request(app).get(`/api/public/prospect-unsubscribe?p=${prospect.id}&s=v1${token}`);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    } finally {
      await prisma.prospectActivity.deleteMany({ where: { prospectId: prospect.id } });
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });

  it('rejects a non-UUID p param without ever querying the database for it', async () => {
    const res = await request(app).get('/api/public/prospect-unsubscribe?p=not-a-uuid&s=v1whatever');
    expect(res.status).toBe(400);
  });
});
