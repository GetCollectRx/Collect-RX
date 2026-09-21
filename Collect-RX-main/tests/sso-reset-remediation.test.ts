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
  it('stores only the token digest while returning the random bearer token', async () => {
    const updateMany = vi.fn().mockReturnValue({ operation: 'invalidate' });
    const create = vi.fn().mockImplementation((args) => ({ operation: 'create', args }));
    const transaction = vi.fn().mockResolvedValue([]);
    const prisma = {
      passwordResetToken: { updateMany, create },
      $transaction: transaction,
    } as unknown as PrismaClient;

    const rawToken = await issuePasswordResetToken(prisma, 'user-1', new Date('2026-09-20T12:00:00Z'));
    const createArgs = create.mock.calls[0]?.[0];

    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(createArgs.data.token).toBe(hashPasswordResetToken(rawToken));
    expect(createArgs.data.token).not.toBe(rawToken);
    expect(createArgs.data.expiresAt).toEqual(new Date('2026-09-20T13:00:00Z'));
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('atomically consumes an unexpired token once and revokes existing sessions', async () => {
    const now = new Date('2026-09-20T12:00:00Z');
    const rawToken = 'raw-secret-token';
    const findUnique = vi.fn().mockResolvedValue({
      id: 'reset-1',
      userId: 'user-1',
      usedAt: null,
      expiresAt: new Date('2026-09-20T13:00:00Z'),
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const userUpdate = vi.fn().mockResolvedValue({ id: 'user-1' });
    const tx = {
      passwordResetToken: { findUnique, updateMany },
      user: { update: userUpdate },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<boolean>) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      consumePasswordResetToken(prisma, rawToken, 'new-password-hash', now),
    ).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { token: hashPasswordResetToken(rawToken) },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'reset-1', usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-password-hash', tokenExpiresAt: now },
    });
  });

  it('rejects expired, used, unknown, and concurrently claimed tokens without changing a password', async () => {
    const now = new Date('2026-09-20T12:00:00Z');
    for (const record of [
      null,
      { id: 'r', userId: 'u', usedAt: new Date(), expiresAt: new Date('2026-09-20T13:00:00Z') },
      { id: 'r', userId: 'u', usedAt: null, expiresAt: new Date('2026-09-20T11:59:59Z') },
    ]) {
      const userUpdate = vi.fn();
      const tx = {
        passwordResetToken: { findUnique: vi.fn().mockResolvedValue(record), updateMany: vi.fn() },
        user: { update: userUpdate },
      };
      const prisma = {
        $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<boolean>) => fn(tx)),
      } as unknown as PrismaClient;
      await expect(consumePasswordResetToken(prisma, 'token', 'hash', now)).resolves.toBe(false);
      expect(userUpdate).not.toHaveBeenCalled();
    }

    const userUpdate = vi.fn();
    const tx = {
      passwordResetToken: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'r', userId: 'u', usedAt: null, expiresAt: new Date('2026-09-20T13:00:00Z'),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: { update: userUpdate },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<boolean>) => fn(tx)),
    } as unknown as PrismaClient;
    await expect(consumePasswordResetToken(prisma, 'token', 'hash', now)).resolves.toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
