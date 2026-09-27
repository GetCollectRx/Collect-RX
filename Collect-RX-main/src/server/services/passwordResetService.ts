import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const RESET_TOKEN_DOMAIN = 'collectrx-password-reset-v1:';

/** Store only a deterministic one-way digest; the bearer token exists only in the email. */
export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(RESET_TOKEN_DOMAIN).update(token, 'utf8').digest('hex');
}

export async function issuePasswordResetToken(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashPasswordResetToken(token);
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);

  // Raw SQL on `tx` only, never an extended-client call: the RLS extension's
  // $allOperations hook reroutes extended calls through the top-level client's
  // own $transaction, opening a second connection instead of reusing this
  // transaction's — the same self-deadlock/atomicity break already found and
  // fixed in reserveDispatchSlot() and emrSyncOutbox.ts.
  // Bind Dates as explicit UTC ISO strings cast with ::timestamp, not native
  // Date objects: raw-query parameter serialization of a Date against a
  // "timestamp without time zone" column doesn't go through the same
  // UTC-normalizing path typed Prisma methods use (Postgres rejects an
  // unqualified text/timestamp bind outright — code 42804). A "Z"-suffixed
  // ISO string cast to ::timestamp sidesteps both: Postgres's naive
  // `timestamp` parser ignores any offset in the input and stores the
  // literal digits, which for toISOString() are always UTC — matching what
  // Prisma's typed methods already store.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE "PasswordResetToken" SET "usedAt" = $1::timestamp WHERE "userId" = $2 AND "usedAt" IS NULL`,
      now.toISOString(),
      userId,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "PasswordResetToken" (id, "userId", token, "expiresAt") VALUES ($1, $2, $3, $4::timestamp)`,
      randomUUID(),
      userId,
      tokenHash,
      expiresAt.toISOString(),
    );
  });

  return token;
}

/**
 * Atomically claims an unexpired, unused token before changing the password.
 * The conditional update prevents two concurrent confirmations from both
 * consuming the same bearer token.
 */
export async function consumePasswordResetToken(
  prisma: PrismaClient,
  token: string,
  passwordHash: string,
  now = new Date(),
): Promise<boolean> {
  const tokenHash = hashPasswordResetToken(token);

  // Raw SQL on `tx` only — see issuePasswordResetToken above for why.
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<
      Array<{ id: string; userId: string; usedAt: Date | null; expiresAt: Date }>
    >(
      `SELECT id, "userId", "usedAt", "expiresAt" FROM "PasswordResetToken" WHERE token = $1`,
      tokenHash,
    );
    const record = rows[0];
    if (!record || record.usedAt || record.expiresAt <= now) return false;

    const claimed = await tx.$executeRawUnsafe(
      `UPDATE "PasswordResetToken" SET "usedAt" = $1::timestamp WHERE id = $2 AND "usedAt" IS NULL AND "expiresAt" > $3::timestamp`,
      now.toISOString(),
      record.id,
      now.toISOString(),
    );
    if (claimed !== 1) return false;

    await tx.$executeRawUnsafe(
      `UPDATE "User" SET "passwordHash" = $1, "tokenExpiresAt" = $2::timestamp WHERE id = $3`,
      passwordHash,
      now.toISOString(),
      record.userId,
    );
    return true;
  });
}
