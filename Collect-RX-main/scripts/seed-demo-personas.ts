/**
 * Seeds one user per practice role into the demo practice so every persona's
 * workflow can be demoed or verified. Idempotent (upserts by email).
 *
 * Usage: npx tsx scripts/seed-demo-personas.ts
 * All logins share the demo password: CollectRx2026!
 */

import 'dotenv/config';
import { PrismaClient, type PracticeRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_PRACTICE_NAME = process.env.SEED_PRACTICE_NAME || 'CollectRx Demo Practice';
const PASSWORD = process.env.SEED_PRACTICE_PASSWORD || 'CollectRx2026!';

const PERSONAS: Array<{ email: string; role: PracticeRole; displayName: string; providerId?: string; tokenDays?: number }> = [
  { email: 'om@collectrx-test.local', role: 'office_manager', displayName: 'Olivia Manager' },
  { email: 'billing@collectrx-test.local', role: 'billing_coordinator', displayName: 'Ben Coordinator' },
  { email: 'desk@collectrx-test.local', role: 'front_desk', displayName: 'Fran Desk' },
  { email: 'associate@collectrx-test.local', role: 'associate_dentist', displayName: 'Dr. Ash Associate', providerId: 'DR-001' },
  { email: 'accountant@collectrx-test.local', role: 'accountant', displayName: 'Alex Accountant', tokenDays: 90 },
  { email: 'group@collectrx-test.local', role: 'group_admin', displayName: 'Grace Group' },
];

async function main() {
  const practice = await prisma.practice.findFirst({ where: { name: DEMO_PRACTICE_NAME } });
  if (!practice) {
    console.error(`Demo practice "${DEMO_PRACTICE_NAME}" not found. Run npm run demo:seed first.`);
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  for (const p of PERSONAS) {
    const tokenExpiresAt = p.tokenDays
      ? new Date(Date.now() + p.tokenDays * 24 * 60 * 60 * 1000)
      : null;
    await prisma.user.upsert({
      where: { email: p.email },
      update: { practiceId: practice.id, role: p.role, passwordHash, isActive: true, providerId: p.providerId ?? null, tokenExpiresAt },
      create: {
        practiceId: practice.id,
        email: p.email,
        passwordHash,
        role: p.role,
        displayName: p.displayName,
        providerId: p.providerId ?? null,
        tokenExpiresAt,
      },
    });
    console.log(`✅ ${p.role.padEnd(20)} ${p.email}`);
  }
  console.log(`\nAll persona logins use password: ${PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
