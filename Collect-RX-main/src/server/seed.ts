import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEFAULT_SEED_EMAIL = 'owner@tenthline.local';

async function main() {
  console.log('🌱 Seeding database (insurance-only baseline)...');

  const defaultPassword = (process.env.SEED_PRACTICE_PASSWORD || '').trim();
  if (!defaultPassword) {
    throw new Error('SEED_PRACTICE_PASSWORD is required (no default). Set it in .env before running db:seed.');
  }
  const seedEmail = (process.env.SEED_USER_EMAIL || DEFAULT_SEED_EMAIL).trim().toLowerCase();
  const passwordHash = await bcrypt.hash(defaultPassword, 12);

  const practice = await prisma.practice.create({
    data: {
      name: 'Tenth Line Family Dentistry',
      timezone: 'America/Toronto',
      passwordHash,
    },
  });
  console.log(`✅ Created practice: ${practice.name}`);

  await prisma.user.create({
    data: {
      practiceId: practice.id,
      email: seedEmail,
      passwordHash,
      role: 'practice_owner',
      displayName: 'Practice Owner',
      isActive: true,
    },
  });
  console.log(`✅ Created user: ${seedEmail} (password from SEED_PRACTICE_PASSWORD)`);

  console.log('\n✨ Seed completed successfully!');
  console.log(`\n📊 Practice ID: ${practice.id}`);
  console.log(`🔐 Sign in at /login with ${seedEmail} and SEED_PRACTICE_PASSWORD`);
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
