/**
 * Ensure a practice_owner User exists for login (db:seed only creates Practice).
 * Run on staging: fly ssh console -a collect-rx-staging -C "node scripts/ensure-staging-owner.mjs"
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_PRACTICE_EMAIL || 'staging-owner@collectrx.test').trim();
  const password = (process.env.SEED_PRACTICE_PASSWORD || '').trim();
  if (!password) throw new Error('SEED_PRACTICE_PASSWORD required');

  const practiceId = process.env.SEED_PRACTICE_ID?.trim();
  const practice = practiceId
    ? await prisma.practice.findUnique({ where: { id: practiceId } })
    : await prisma.practice.findFirst({
        where: { name: process.env.SEED_PRACTICE_NAME || 'CollectRx Staging Practice' },
      }) || await prisma.practice.findFirst();

  if (!practice) throw new Error('No practice found — run npm run db:seed first');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      practiceId: practice.id,
      passwordHash,
      role: 'practice_owner',
      isActive: true,
    },
    create: {
      practiceId: practice.id,
      email,
      passwordHash,
      role: 'practice_owner',
      displayName: 'Staging Owner',
      isActive: true,
    },
  });

  console.log(`OK owner ${user.email} → practice ${practice.id} (${practice.name})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
