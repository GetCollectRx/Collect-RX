import { prisma } from '../src/lib/prisma.js';
import { runWithRlsBypass } from '../src/server/db/rlsContext.js';

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

async function main() {
  await runWithRlsBypass(async () => {
    const practices = await prisma.practice.findMany({
      where: { billingTier: 'trial', trialEndsAt: null },
      select: { id: true, name: true },
    });
    for (const p of practices) {
      const firstUser = await prisma.user.findFirst({
        where: { practiceId: p.id },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const anchor = firstUser?.createdAt ?? new Date();
      const trialEndsAt = new Date(anchor.getTime() + THIRTY_DAYS);
      await prisma.practice.update({ where: { id: p.id }, data: { trialEndsAt } });
      console.log('backfilled:', p.name, '-> trialEndsAt', trialEndsAt.toISOString());
    }
    console.log('total backfilled:', practices.length);
  });
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
