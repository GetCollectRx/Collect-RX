#!/usr/bin/env node
/**
 * Set (or create) test logins for every CollectRx persona.
 *
 * Practice staff → `users` table (main login form).
 * Auditor / billing ops / platform admin → `platform_users` (collapsible platform login).
 * Platform developer → PLATFORM_DEV_PASSWORD in .env (not stored in DB).
 *
 * Usage:
 *   node scripts/set-persona-test-passwords.mjs
 *   railway run node scripts/set-persona-test-passwords.mjs
 *
 * Password: PERSONA_TEST_PASSWORD or SEED_PRACTICE_PASSWORD (min 8 chars).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const TEST_PASSWORD = (
  process.env.PERSONA_TEST_PASSWORD ||
  process.env.SEED_PRACTICE_PASSWORD ||
  ''
).trim();

if (!TEST_PASSWORD || TEST_PASSWORD.length < 8) {
  console.error('Set PERSONA_TEST_PASSWORD or SEED_PRACTICE_PASSWORD (min 8 chars) before running.');
  process.exit(1);
}

/** Practice-layer roles (email login on main form). */
const PRACTICE_PERSONAS = [
  { email: 'demo@collectrx-test.local', role: 'practice_owner', displayName: 'Demo Owner' },
  { email: 'om@collectrx-test.local', role: 'office_manager', displayName: 'Office Manager' },
  { email: 'billing@collectrx-test.local', role: 'billing_coordinator', displayName: 'Billing Coordinator' },
  { email: 'desk@collectrx-test.local', role: 'front_desk', displayName: 'Front Desk' },
  { email: 'associate@collectrx-test.local', role: 'associate_dentist', displayName: 'Associate Dentist' },
  { email: 'accountant@collectrx-test.local', role: 'accountant', displayName: 'Accountant' },
  { email: 'group@collectrx-test.local', role: 'group_admin', displayName: 'Group Admin' },
];

/** Brief personas (platform-user login — second form on login page). */
const PLATFORM_PERSONAS = [
  { email: 'auditor@collectrx.ca', userRole: 'auditor', grantAllPractices: true },
  { email: 'billingops@collectrx.ca', userRole: 'billing_ops_manager', grantAllPractices: false },
  { email: 'platformadmin@collectrx.ca', userRole: 'platform_admin', grantAllPractices: false },
];

const prisma = new PrismaClient();

async function upsertPracticeUsers(practiceId, passwordHash) {
  const accountantExpiry = new Date();
  accountantExpiry.setFullYear(accountantExpiry.getFullYear() + 1);

  for (const persona of PRACTICE_PERSONAS) {
    const existing = await prisma.user.findUnique({ where: { email: persona.email } });
    const data = {
      practiceId,
      email: persona.email,
      passwordHash,
      role: persona.role,
      displayName: persona.displayName,
      isActive: true,
      providerId: persona.role === 'associate_dentist' ? 'demo-provider-1' : null,
      ...(persona.role === 'accountant' ? { tokenExpiresAt: accountantExpiry } : { tokenExpiresAt: null }),
    };

    if (existing) {
      await prisma.user.update({
        where: { email: persona.email },
        data: {
          passwordHash,
          role: persona.role,
          displayName: persona.displayName,
          isActive: true,
          providerId: persona.role === 'associate_dentist' ? 'demo-provider-1' : null,
          ...(persona.role === 'accountant' ? { tokenExpiresAt: accountantExpiry } : { tokenExpiresAt: null }),
        },
      });
      console.log(`updated  practice.${persona.role.padEnd(22)} ${persona.email}`);
    } else {
      await prisma.user.create({ data });
      console.log(`created  practice.${persona.role.padEnd(22)} ${persona.email}`);
    }
  }
}

async function upsertPlatformUsers(practiceId, passwordHash) {
  for (const persona of PLATFORM_PERSONAS) {
    const existing = await prisma.platformUser.findUnique({ where: { email: persona.email } });
    const practiceIdForUser =
      persona.userRole === 'billing_ops_manager' ? practiceId : null;

    if (existing) {
      await prisma.platformUser.update({
        where: { email: persona.email },
        data: {
          passwordHash,
          userRole: persona.userRole,
          practiceId: practiceIdForUser,
          active: true,
        },
      });
      console.log(`updated  platform.${persona.userRole.padEnd(18)} ${persona.email}`);
    } else {
      await prisma.platformUser.create({
        data: {
          id: randomUUID(),
          email: persona.email,
          passwordHash,
          userRole: persona.userRole,
          practiceId: practiceIdForUser,
          active: true,
        },
      });
      console.log(`created  platform.${persona.userRole.padEnd(18)} ${persona.email}`);
    }

    if (persona.userRole === 'auditor' && persona.grantAllPractices) {
      const auditor = await prisma.platformUser.findUnique({ where: { email: persona.email } });
      if (auditor) {
        const existingGrant = await prisma.auditorGrant.findFirst({
          where: { auditorUserId: auditor.id, practiceId: null },
        });
        if (!existingGrant) {
          await prisma.auditorGrant.create({
            data: { auditorUserId: auditor.id, practiceId: null },
          });
          console.log('         auditor grant: all practices');
        }
      }
    }

    if (persona.userRole === 'platform_admin') {
      const admin = await prisma.platformUser.findUnique({ where: { email: persona.email } });
      const owner = await prisma.user.findFirst({
        where: { practiceId, role: 'practice_owner', isActive: true },
      });
      if (admin && owner) {
        await prisma.platformAdminPracticeGrant.upsert({
          where: {
            adminUserId_practiceId: { adminUserId: admin.id, practiceId },
          },
          create: {
            adminUserId: admin.id,
            practiceId,
            grantedByOwnerId: owner.id,
          },
          update: {},
        });
        console.log(`         platform_admin claim grant for practice ${practiceId.slice(0, 8)}…`);
      }
    }
  }
}

async function main() {
  const practiceName = process.env.SEED_PRACTICE_NAME || 'CollectRx Demo Practice';
  const practice = await prisma.practice.findFirst({ where: { name: practiceName } });
  if (!practice) {
    throw new Error(`Practice "${practiceName}" not found — run npm run demo:seed first.`);
  }

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  console.log(`Practice: ${practice.name} (${practice.id})`);
  console.log(`Password: (from SEED_PRACTICE_PASSWORD / PERSONA_TEST_PASSWORD)\n`);

  await upsertPracticeUsers(practice.id, passwordHash);
  console.log('');
  await upsertPlatformUsers(practice.id, passwordHash);

  console.log('\n── Login cheat sheet ──');
  console.log(`Password for every account below: ${TEST_PASSWORD}`);
  console.log('Main sign-in form (@collectrx-test.local): demo@, om@, billing@, desk@, associate@, accountant@, group@');
  console.log('Platform roles form (@collectrx.ca): auditor@, billingops@, platformadmin@');
  console.log(`Platform developer (footer form, no email): ${process.env.PLATFORM_DEV_PASSWORD || '(set PLATFORM_DEV_PASSWORD in .env)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
