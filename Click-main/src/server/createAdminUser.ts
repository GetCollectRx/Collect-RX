/**
 * One-time script: create an admin user for the first practice in the DB.
 * Run: npx tsx src/server/createAdminUser.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const practice = await prisma.practice.findFirst();
  if (!practice) {
    console.error('❌ No practice found. Run: npm run db:seed first.');
    process.exit(1);
  }

  const email = 'admin@collectrx.com';
  const password = 'CollectRx2026!';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`ℹ️  User ${email} already exists — skipping.`);
    console.log(`   Practice: ${practice.name} (${practice.id})`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      practiceId: practice.id,
      email,
      passwordHash,
      role: 'admin',
      isActive: true,
    },
  });

  console.log('✅ Admin user created!');
  console.log(`   Email:    ${user.email}`);
  console.log(`   Password: ${password}`);
  console.log(`   Role:     ${user.role}`);
  console.log(`   Practice: ${practice.name} (${practice.id})`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
