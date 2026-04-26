/**
 * After `npm run db:seed`, print the first practice id for Playwright (CI sets E2E_PRACTICE_ID).
 * Usage: npx tsx scripts/print-e2e-practice-id.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const row = await prisma.practice.findFirst({ orderBy: { name: 'asc' } });
if (!row) {
  await prisma.$disconnect();
  process.stderr.write('print-e2e-practice-id: no practice in DB. Run db:seed first.\n');
  process.exit(1);
}
process.stdout.write(row.id);
await prisma.$disconnect();
