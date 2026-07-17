import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database (baseline practice, no claims)...');

  const defaultPassword = (process.env.SEED_PRACTICE_PASSWORD || '').trim();
  if (!defaultPassword) {
    throw new Error('SEED_PRACTICE_PASSWORD is required (no default). Set it in .env before running db:seed.');
  }
  const passwordHash = await bcrypt.hash(defaultPassword, 12);

  const practiceName = process.env.SEED_PRACTICE_NAME || 'CollectRx Demo Practice';
  const ownerEmail = (process.env.SEED_PRACTICE_EMAIL || 'demo@collectrx-test.local').trim();
  const practice = await prisma.practice.create({
    data: {
      name: practiceName,
      timezone: 'America/Toronto',
      passwordHash,
    },
  });
  console.log(`✅ Created practice: ${practice.name}`);

  // Login is email/password against User — practice.passwordHash alone is not enough.
  await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {
      practiceId: practice.id,
      passwordHash,
      role: 'practice_owner',
      isActive: true,
    },
    create: {
      practiceId: practice.id,
      email: ownerEmail,
      passwordHash,
      role: 'practice_owner',
      displayName: 'Practice Owner',
      isActive: true,
    },
  });
  console.log(`✅ Owner user: ${ownerEmail}`);

  console.log('\n✨ Seed completed successfully!');
  console.log(`\n📊 Practice ID: ${practice.id}`);
  console.log(`🔐 Sign in: ${ownerEmail} / (SEED_PRACTICE_PASSWORD)`);
  console.log('💡 For rich insurance demo data (claims, calls, recovery), run: npm run demo:seed');
  console.log('   CollectRx no longer seeds patient outreach balances — insurance carrier recovery only.');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
