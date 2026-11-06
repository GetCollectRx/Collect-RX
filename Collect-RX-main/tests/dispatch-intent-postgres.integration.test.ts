import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { confirmDispatch, ensureDispatchIntent, markDispatchSending } from '../src/server/frontDesk/dispatchIntent.js';
import { createPracticeForTests } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  // Required release invocation treats this skip as a failed gate.
}

describe.skipIf(!dbReady)('durable dispatch intent — real PostgreSQL', () => {
  it('commits intent before send and atomically confirms the call lifecycle', async () => {
    const practice = await createPracticeForTests(prisma);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId: practice.id, carrierId: 'sun_life', claimNumber: `DI-${suffix}`,
        patientToken: `token-${suffix}`, billedAmount: 100, outstandingAmount: 100,
        daysOutstanding: 30, status: 'IN_QUEUE',
      },
    });
    const queue = await prisma.callQueue.create({
      data: { practiceId: practice.id, claimId: claim.id, scheduledFor: new Date(), status: 'PENDING' },
    });

    try {
      const intent = await ensureDispatchIntent(prisma, {
        practiceId: practice.id, claimId: claim.id, queueEntryId: queue.id, attemptNumber: 1,
      });
      expect(intent.status).toBe('READY');
      await markDispatchSending(prisma, intent.id);
      const attempt = await confirmDispatch(prisma, {
        intentId: intent.id, queueEntryId: queue.id, claimId: claim.id, vapiCallId: `vapi-${suffix}`,
      });

      const [storedIntent, storedQueue, storedClaim] = await Promise.all([
        prisma.callDispatchIntent.findUniqueOrThrow({ where: { id: intent.id } }),
        prisma.callQueue.findUniqueOrThrow({ where: { id: queue.id } }),
        prisma.insuranceClaim.findUniqueOrThrow({ where: { id: claim.id } }),
      ]);
      expect(storedIntent.status).toBe('CONFIRMED');
      expect(storedIntent.vapiCallId).toBe(`vapi-${suffix}`);
      expect(attempt.dispatchIntentId).toBe(intent.id);
      expect(storedQueue).toMatchObject({ status: 'IN_PROGRESS', attempts: 1 });
      expect(storedClaim.status).toBe('CALLING');
    } finally {
      await prisma.callAttempt.deleteMany({ where: { claimId: claim.id } });
      await prisma.callDispatchIntent.deleteMany({ where: { claimId: claim.id } });
      await prisma.callQueue.deleteMany({ where: { claimId: claim.id } });
      await prisma.insuranceClaim.delete({ where: { id: claim.id } });
      await prisma.practice.delete({ where: { id: practice.id } });
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});
