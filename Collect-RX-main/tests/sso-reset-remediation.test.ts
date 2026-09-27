import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { findSsoUserForOrganization } from '../src/server/routes/ssoRoutes.js';
import {
  consumePasswordResetToken,
  hashPasswordResetToken,
  issuePasswordResetToken,
} from '../src/server/services/passwordResetService.js';

describe('SSO organization binding', () => {
  it('requires the asserted user to be an active member of the authenticating organization', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { user: { findFirst } } as unknown as PrismaClient;

    const result = await findSsoUserForOrganization(
      prisma,
      'asserting-org',
      'same-email@other-dso.test',
    );

    expect(result).toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        email: 'same-email@other-dso.test',
        isActive: true,
        organizationMemberships: { some: { organizationId: 'asserting-org' } },
      },
    });
  });
});

describe('password-reset token storage and consumption', () => {
  // issuePasswordResetToken/consumePasswordResetToken run every query as raw
  // SQL on `tx` (never an extended-model call) to avoid the RLS extension
  // rerouting extended calls through the top-level client's own transaction —
  // see the comment in passwordResetService.ts. Mocks below reflect that:
  // tx.$executeRawUnsafe / tx.$queryRawUnsafe, not tx.passwordResetToken.*.

  it('stores only the token digest while returning the random bearer token', async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(1);
    const tx = { $executeRawUnsafe: executeRawUnsafe };
    const transaction = vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    const rawToken = await issuePasswordResetToken(prisma, 'user-1', new Date('2026-09-20T12:00:00Z'));
    const insertCall = executeRawUnsafe.mock.calls[1];
    const [insertSql, , insertUserId, insertTokenHash, insertExpiresAt] = insertCall as [
      string,
      string,
      string,
      string,
      string,
    ];

    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(insertSql).toMatch(/INSERT INTO "PasswordResetToken"/);
    expect(insertUserId).toBe('user-1');
    expect(insertTokenHash).toBe(hashPasswordResetToken(rawToken));
    expect(insertTokenHash).not.toBe(rawToken);
    expect(insertExpiresAt).toBe('2026-09-20T13:00:00.000Z');
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('atomically consumes an unexpired token once and revokes existing sessions', async () => {
    const now = new Date('2026-09-20T12:00:00Z');
    const rawToken = 'raw-secret-token';
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      { id: 'reset-1', userId: 'user-1', usedAt: null, expiresAt: new Date('2026-09-20T13:00:00Z') },
    ]);
    const executeRawUnsafe = vi.fn().mockResolvedValue(1);
    const tx = { $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: executeRawUnsafe };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<boolean>) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      consumePasswordResetToken(prisma, rawToken, 'new-password-hash', now),
    ).resolves.toBe(true);
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT .* FROM "PasswordResetToken" WHERE token = \$1/),
      hashPasswordResetToken(rawToken),
    );
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/UPDATE "PasswordResetToken" SET "usedAt"/),
      now.toISOString(),
      'reset-1',
      now.toISOString(),
    );
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/UPDATE "User" SET "passwordHash"/),
      'new-password-hash',
      now.toISOString(),
      'user-1',
    );
  });

  it('rejects expired, used, unknown, and concurrently claimed tokens without changing a password', async () => {
    const now = new Date('2026-09-20T12:00:00Z');
    for (const record of [
      null,
      { id: 'r', userId: 'u', usedAt: new Date(), expiresAt: new Date('2026-09-20T13:00:00Z') },
      { id: 'r', userId: 'u', usedAt: null, expiresAt: new Date('2026-09-20T11:59:59Z') },
    ]) {
      const executeRawUnsafe = vi.fn();
      const tx = {
        $queryRawUnsafe: vi.fn().mockResolvedValue(record ? [record] : []),
        $executeRawUnsafe: executeRawUnsafe,
      };
      const prisma = {
        $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<boolean>) => fn(tx)),
      } as unknown as PrismaClient;
      await expect(consumePasswordResetToken(prisma, 'token', 'hash', now)).resolves.toBe(false);
      expect(executeRawUnsafe).not.toHaveBeenCalled();
    }

    const executeRawUnsafe = vi.fn().mockResolvedValue(0);
    const tx = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        { id: 'r', userId: 'u', usedAt: null, expiresAt: new Date('2026-09-20T13:00:00Z') },
      ]),
      $executeRawUnsafe: executeRawUnsafe,
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<boolean>) => fn(tx)),
    } as unknown as PrismaClient;
    await expect(consumePasswordResetToken(prisma, 'token', 'hash', now)).resolves.toBe(false);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
