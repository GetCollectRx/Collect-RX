#!/usr/bin/env node
/**
 * Set (or create) one test user per practice role with a shared password.
 * Usage (production): railway run node scripts/set-persona-test-passwords.mjs
 * Password from PERSONA_TEST_PASSWORD env, else SEED_PRACTICE_PASSWORD, else exits.
 */
import 'dotenv/config';
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

const PERSONAS = [
  { email: 'tenthlinefd@collectrx.ca', role: 'practice_owner', displayName: 'Tenth Line Owner' },
  { email: 'managertfd@collectrx.ca', role: 'office_manager', displayName: 'Office Manager' },
  { email: 'billingtfd@collectrx.ca', role: 'billing_coordinator', displayName: 'Billing Coordinator' },
  { email: 'frontdesktfd@collectrx.ca', role: 'front_desk', displayName: 'Front Desk' },
  { email: 'dentisttfd@collectrx.ca', role: 'associate_dentist', displayName: 'Associate Dentist' },
  { email: 'accountanttfd@collectrx.ca', role: 'accountant', displayName: 'Accountant' },
  { email: 'groupadmintfd@collectrx.ca', role: 'group_admin', displayName: 'Group Admin' },
];

const prisma = new PrismaClient();

async function main() {
  const practice = await prisma.practice.findFirst({ orderBy: { name: 'asc' } });
  if (!practice) {
    throw new Error('No practice in database — run db:seed first.');
  }

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const accountantExpiry = new Date();
  accountantExpiry.setFullYear(accountantExpiry.getFullYear() + 1);

  for (const persona of PERSONAS) {
    const existing = await prisma.user.findUnique({ where: { email: persona.email } });
    const data = {
      practiceId: practice.id,
      email: persona.email,
      passwordHash,
      role: persona.role,
      displayName: persona.displayName,
      isActive: true,
      providerId: persona.role === 'associate_dentist' ? 'tfd-provider-1' : null,
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
          providerId: persona.role === 'associate_dentist' ? 'tfd-provider-1' : null,
          ...(persona.role === 'accountant' ? { tokenExpiresAt: accountantExpiry } : { tokenExpiresAt: null }),
        },
      });
      console.log(`updated  ${persona.role.padEnd(22)} ${persona.email}`);
    } else {
      await prisma.user.create({ data });
      console.log(`created  ${persona.role.padEnd(22)} ${persona.email}`);
    }
  }

  console.log('\nShared password set for all practice personas (see PERSONA_TEST_PASSWORD / SEED_PRACTICE_PASSWORD).');
  console.log('Platform developer: use PLATFORM_DEV_PASSWORD on the login page (separate, not in User table).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
