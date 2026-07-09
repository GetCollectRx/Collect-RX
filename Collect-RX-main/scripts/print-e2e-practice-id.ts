/**
 * After `npm run db:seed`, print the first user's email for Playwright.
 * Usage: npx tsx scripts/print-e2e-practice-id.ts
 *
 * Legacy script name kept for npm run e2e:print-id — output is now the login email.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
if (!user) {
  await prisma.$disconnect();
  process.stderr.write('print-e2e-practice-id: no user in DB. Run db:seed first.\n');
  process.exit(1);
}
process.stdout.write(user.email);
await prisma.$disconnect();
