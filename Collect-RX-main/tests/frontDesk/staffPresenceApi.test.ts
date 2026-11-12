/**
 * Staff presence over the desk API: set your own availability, read the practice's, and the freshness rule.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../../src/server/index.js';
import { COOKIE_NAME, signUserToken } from '../../src/server/authToken.js';
import { readyStaffCount } from '../../src/server/frontDesk/staffPresence.js';
import { createPracticeForTests, createUserForTests, cleanupPracticeWithUsers } from '../factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  /* skip */
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

const cookie = (userId: string, practiceId: string, role: 'front_desk' | 'practice_owner'): string =>
  `${COOKIE_NAME}=${signUserToken({ userId, practiceId, role })}`;

describe.skipIf(!dbReady)('desk staff presence', () => {
  it('lets a staff member set availability, counts only fresh available people, and scopes to the practice', async () => {
    const practice = await createPracticeForTests(prisma);
    const other = await createPracticeForTests(prisma);
    const a = await createUserForTests(prisma, practice.id, 'front_desk');
    const b = await createUserForTests(prisma, practice.id, 'front_desk');
    const outsider = await createUserForTests(prisma, other.id, 'front_desk');
    try {
      const url = `/api/desk/${practice.id}/presence`;
      const asA = cookie(a.id, practice.id, 'front_desk');

      const bad = await request(app).put(url).set('Cookie', asA).send({ status: 'ASLEEP' });
      expect(bad.status).toBe(400);

      const set = await request(app).put(url).set('Cookie', asA).send({ status: 'AVAILABLE' });
      expect(set.status).toBe(200);
      expect(set.body.data.readyCount).toBe(1);

      await request(app).put(url).set('Cookie', cookie(b.id, practice.id, 'front_desk')).send({ status: 'AVAILABLE' });
      expect(await readyStaffCount(prisma, practice.id)).toBe(2);

      // A busy person is not ready.
      await request(app).put(url).set('Cookie', asA).send({ status: 'BUSY' });
      expect(await readyStaffCount(prisma, practice.id)).toBe(1);

      // A stale AVAILABLE counts as off.
      await prisma.staffPresence.updateMany({ where: { practiceId: practice.id, userId: b.id }, data: { updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000) } });
      expect(await readyStaffCount(prisma, practice.id)).toBe(0);

      const read = await request(app).get(url).set('Cookie', asA);
      expect(read.status).toBe(200);
      expect(read.body.data.entries).toHaveLength(2);
      expect(read.body.data.mine.status).toBe('BUSY');

      // Another practice's person cannot set presence here, and sees nothing of it.
      const intruder = await request(app).put(url).set('Cookie', cookie(outsider.id, other.id, 'front_desk')).send({ status: 'AVAILABLE' });
      expect(intruder.status).toBeGreaterThanOrEqual(400);
      expect(await prisma.staffPresence.count({ where: { practiceId: other.id } })).toBe(0);
    } finally {
      await prisma.staffPresence.deleteMany({ where: { practiceId: { in: [practice.id, other.id] } } });
      await cleanupPracticeWithUsers(prisma, practice.id);
      await cleanupPracticeWithUsers(prisma, other.id);
    }
  });
});
