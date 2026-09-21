import { createHash, randomBytes } from 'node:crypto';
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

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: { userId, token: tokenHash, expiresAt },
    }),
  ]);

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

  return prisma.$transaction(async (tx) => {
    const record = await tx.passwordResetToken.findUnique({ where: { token: tokenHash } });
    if (!record || record.usedAt || record.expiresAt <= now) return false;

    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;

    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, tokenExpiresAt: now },
    });
    return true;
  });
}
