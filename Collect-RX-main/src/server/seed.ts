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
  const practice = await prisma.practice.create({
    data: {
      name: practiceName,
      timezone: 'America/Toronto',
      passwordHash,
    },
  });
  console.log(`✅ Created practice: ${practice.name}`);

  console.log('\n✨ Seed completed successfully!');
  console.log(`\n📊 Practice ID: ${practice.id}`);
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
