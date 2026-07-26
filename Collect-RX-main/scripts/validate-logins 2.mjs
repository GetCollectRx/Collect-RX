#!/usr/bin/env node
/**
 * Validate which seeded logins exist in the DB and accept known dev passwords.
 * Local only — reads DATABASE_URL + SEED_PRACTICE_PASSWORD from .env.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';

const PRACTICE_ACCOUNTS = [
  ['demo@collectrx-test.local', 'practice_owner'],
  ['om@collectrx-test.local', 'office_manager'],
  ['billing@collectrx-test.local', 'billing_coordinator'],
  ['desk@collectrx-test.local', 'front_desk'],
  ['associate@collectrx-test.local', 'associate_dentist'],
  ['accountant@collectrx-test.local', 'accountant'],
  ['group@collectrx-test.local', 'group_admin'],
];

const PLATFORM_ACCOUNTS = [
  ['auditor@collectrx.ca', 'auditor'],
  ['billingops@collectrx.ca', 'billing_ops_manager'],
  ['platformadmin@collectrx.ca', 'platform_admin'],
];

const PASSWORD_CANDIDATES = [
  process.env.SEED_PRACTICE_PASSWORD,
  process.env.PERSONA_TEST_PASSWORD,
  'CollectRx2026!',
].filter(Boolean);

const DEV_PASSWORD = process.env.PLATFORM_DEV_PASSWORD?.trim() || '';

function verifyPlainDevPassword(password) {
  if (!DEV_PASSWORD) return false;
  const a = Buffer.from(password, 'utf8');
  const b = Buffer.from(DEV_PASSWORD, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function matchPassword(hash, candidates) {
  for (const pw of candidates) {
    if (await bcrypt.compare(pw, hash)) return pw;
  }
  return null;
}

async function main() {
  const prisma = new PrismaClient();
  const results = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    console.error('Database unreachable:', e.message);
    console.error('Fix DATABASE_URL in .env (docker: postgresql://collectrx:collectrx_local_dev_only@127.0.0.1:5433/collectrx)');
    process.exit(1);
  }

  for (const [email, label] of PRACTICE_ACCOUNTS) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      results.push({ type: 'practice', email, label, status: 'missing', detail: 'user not in database' });
      continue;
    }
    if (!user.isActive) {
      results.push({ type: 'practice', email, label, status: 'inactive', detail: `role=${user.role}` });
      continue;
    }
    const pw = await matchPassword(user.passwordHash, PASSWORD_CANDIDATES);
    results.push({
      type: 'practice',
      email,
      label,
      status: pw ? 'ok' : 'bad_password',
      detail: pw ? `role=${user.role}, password=${pw}` : `role=${user.role}, no candidate password matched`,
    });
  }

  for (const [email, label] of PLATFORM_ACCOUNTS) {
    const user = await prisma.platformUser.findUnique({ where: { email } });
    if (!user) {
      results.push({ type: 'platform-user', email, label, status: 'missing', detail: 'user not in database' });
      continue;
    }
    if (!user.active) {
      results.push({ type: 'platform-user', email, label, status: 'inactive', detail: `role=${user.userRole}` });
      continue;
    }
    const pw = await matchPassword(user.passwordHash, PASSWORD_CANDIDATES);
    results.push({
      type: 'platform-user',
      email,
      label,
      status: pw ? 'ok' : 'bad_password',
      detail: pw ? `role=${user.userRole}, password=${pw}` : `role=${user.userRole}, no candidate password matched`,
    });
  }

  const devOk = DEV_PASSWORD && verifyPlainDevPassword(DEV_PASSWORD);
  results.push({
    type: 'platform-dev',
    email: '(none)',
    label: 'platform_dev',
    status: devOk ? 'ok' : DEV_PASSWORD ? 'bad_password' : 'not_configured',
    detail: devOk ? `password=${DEV_PASSWORD}` : DEV_PASSWORD ? 'PLATFORM_DEV_PASSWORD set but verify failed' : 'set PLATFORM_DEV_PASSWORD in .env',
  });

  for (const r of results) {
    const mark = r.status === 'ok' ? 'OK' : r.status.toUpperCase();
    const form =
      r.type === 'platform-user'
        ? 'platform-form'
        : r.type === 'platform-dev'
          ? 'dev-form'
          : 'main-form';
    const pw =
      r.status === 'ok'
        ? r.type === 'platform-dev'
          ? DEV_PASSWORD
          : (PASSWORD_CANDIDATES.find((p) => r.detail.includes(p)) || PASSWORD_CANDIDATES[0])
        : '';
    console.log(`${mark}\t${form}\t${r.email}\t${r.label}\t${pw || r.detail}`);
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const missing = results.filter((r) => r.status === 'missing').length;
  console.log(`\nSummary: ${ok} working, ${missing} missing from DB, ${results.length - ok - missing} other issues`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const prisma = new PrismaClient();
    await prisma.$disconnect();
  });
