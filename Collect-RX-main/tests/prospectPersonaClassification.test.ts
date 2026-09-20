/**
 * Persona bucket persistence for the outreach pipeline's Persona Classifier
 * Agent (agents/outreach/persona-classifier.md). Before this, a persona
 * decision existed only inside that run's markdown report — nothing on the
 * Prospect record, nothing searchable. Covers both the direct function
 * (recordPersonaClassification) and the real authenticated route a running
 * agent would actually call.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { recordPersonaClassification } from '../src/server/marketing/personaClassification.js';

const DEV_PW = process.env.PLATFORM_DEV_PASSWORD || 'collectrx-dev-platform-only';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[prospectPersonaClassification] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
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

async function createProspect(): Promise<{ id: string }> {
  return prisma.prospect.create({
    data: { practiceName: `Fixture Dental ${Date.now()}`, email: `prospect-${randomUUID()}@fixture.test` },
    select: { id: true },
  });
}

describe.skipIf(!dbReady)('recordPersonaClassification', () => {
  it('persists the bucket, confidence, and reasoning onto the prospect', async () => {
    const prospect = await createProspect();
    try {
      await recordPersonaClassification(prisma, {
        prospectId: prospect.id,
        bucket: 'DSO Growth / Special Markets / Partnerships exec',
        confidence: 'high',
        reasoning: 'Director of Special Markets at a multi-location DSO — scaling role, not owner-dentist.',
      });

      const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
      expect(updated.personaBucket).toBe('DSO Growth / Special Markets / Partnerships exec');
      expect(updated.personaConfidence).toBe('high');
      expect(updated.personaReasoning).toContain('Director of Special Markets');
      expect(updated.personaAssignedAt).not.toBeNull();
    } finally {
      await prisma.prospectActivity.deleteMany({ where: { prospectId: prospect.id } });
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });

  it('logs a persona_classified activity entry so history survives re-classification', async () => {
    const prospect = await createProspect();
    try {
      await recordPersonaClassification(prisma, {
        prospectId: prospect.id,
        bucket: 'Owner-Dentist',
        confidence: 'medium',
      });

      const activity = await prisma.prospectActivity.findFirst({
        where: { prospectId: prospect.id, type: 'persona_classified' },
      });
      expect(activity?.summary).toContain('Owner-Dentist');
      expect((activity?.metadata as Record<string, unknown> | null)?.confidence).toBe('medium');
    } finally {
      await prisma.prospectActivity.deleteMany({ where: { prospectId: prospect.id } });
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });

  it('rejects a bucket outside the fixed persona-classifier.md list', async () => {
    const prospect = await createProspect();
    try {
      await expect(
        recordPersonaClassification(prisma, {
          prospectId: prospect.id,
          // @ts-expect-error deliberately invalid to prove fail-closed validation
          bucket: 'Made Up Bucket',
          confidence: 'high',
        }),
      ).rejects.toThrow(/Unknown persona bucket/);
    } finally {
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });
});

describe.skipIf(!dbReady)('POST /api/admin/partnerships/prospects/:id/persona', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/admin/partnerships/prospects/does-not-matter/persona')
      .send({ bucket: 'Owner-Dentist', confidence: 'high' });
    expect(res.status).toBe(401);
  });

  it('records a classification and makes it filterable via GET /prospects', async () => {
    const cookie = await platformDevCookie();
    const prospect = await createProspect();
    try {
      const post = await request(app)
        .post(`/api/admin/partnerships/prospects/${prospect.id}/persona`)
        .set('Cookie', cookie)
        .send({
          bucket: 'Billing/AR Staff',
          confidence: 'medium',
          reasoning: 'Listed as AR coordinator on the practice staff page.',
        });
      expect(post.status).toBe(200);
      expect(post.body.data.bucket).toBe('Billing/AR Staff');

      const filtered = await request(app)
        .get('/api/admin/partnerships/prospects?personaBucket=Billing%2FAR%20Staff')
        .set('Cookie', cookie);
      expect(filtered.status).toBe(200);
      const ids = (filtered.body.data as { id: string }[]).map((p) => p.id);
      expect(ids).toContain(prospect.id);
    } finally {
      await prisma.prospectActivity.deleteMany({ where: { prospectId: prospect.id } });
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });

  it('rejects a bucket not in the fixed list with 400, not a 500', async () => {
    const cookie = await platformDevCookie();
    const prospect = await createProspect();
    try {
      const res = await request(app)
        .post(`/api/admin/partnerships/prospects/${prospect.id}/persona`)
        .set('Cookie', cookie)
        .send({ bucket: 'Not A Real Bucket', confidence: 'high' });
      expect(res.status).toBe(400);
    } finally {
      await prisma.prospect.delete({ where: { id: prospect.id } });
    }
  });
});
