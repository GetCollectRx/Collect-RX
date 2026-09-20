import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  assertRlsRoleSafeInProduction,
  evaluateRlsRoleGuard,
  fetchCurrentRoleRlsFlags,
} from '../src/server/db/rlsRoleGuard.js';

describe('evaluateRlsRoleGuard', () => {
  it('skips outside production regardless of role flags', () => {
    const action = evaluateRlsRoleGuard(
      { rolsuper: true, rolbypassrls: true },
      { nodeEnv: 'development', rlsEnabled: true },
    );
    expect(action.kind).toBe('skip');
  });

  it('skips in production when RLS is intentionally disabled', () => {
    const action = evaluateRlsRoleGuard(
      { rolsuper: true, rolbypassrls: true },
      { nodeEnv: 'production', rlsEnabled: false },
    );
    expect(action.kind).toBe('skip');
  });

  it('is ok in production for a NOSUPERUSER NOBYPASSRLS role', () => {
    const action = evaluateRlsRoleGuard(
      { rolsuper: false, rolbypassrls: false },
      { nodeEnv: 'production', rlsEnabled: true },
    );
    expect(action.kind).toBe('ok');
  });

  it('flags a superuser role as unsafe in production', () => {
    const action = evaluateRlsRoleGuard(
      { rolsuper: true, rolbypassrls: false },
      { nodeEnv: 'production', rlsEnabled: true },
    );
    expect(action.kind).toBe('unsafe');
    if (action.kind === 'unsafe') {
      expect(action.message).toContain('a superuser');
      expect(action.message).toContain('COLLECTRX_RLS_ROLE_GUARD=0');
    }
  });

  it('flags a BYPASSRLS role as unsafe in production', () => {
    const action = evaluateRlsRoleGuard(
      { rolsuper: false, rolbypassrls: true },
      { nodeEnv: 'production', rlsEnabled: true },
    );
    expect(action.kind).toBe('unsafe');
    if (action.kind === 'unsafe') {
      expect(action.message).toContain('BYPASSRLS');
      expect(action.message).not.toContain('a superuser and');
    }
  });

  it('flags a role that is both superuser and BYPASSRLS as unsafe', () => {
    const action = evaluateRlsRoleGuard(
      { rolsuper: true, rolbypassrls: true },
      { nodeEnv: 'production', rlsEnabled: true },
    );
    expect(action.kind).toBe('unsafe');
    if (action.kind === 'unsafe') {
      expect(action.message).toContain('a superuser and BYPASSRLS');
    }
  });
});

function mockPrismaWithRoleFlags(rows: Array<{ rolsuper: boolean; rolbypassrls: boolean }>): PrismaClient {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) } as unknown as PrismaClient;
}

describe('fetchCurrentRoleRlsFlags', () => {
  it('returns the first row', async () => {
    const prisma = mockPrismaWithRoleFlags([{ rolsuper: false, rolbypassrls: false }]);
    await expect(fetchCurrentRoleRlsFlags(prisma)).resolves.toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('throws if pg_roles has no matching row', async () => {
    const prisma = mockPrismaWithRoleFlags([]);
    await expect(fetchCurrentRoleRlsFlags(prisma)).rejects.toThrow('could not resolve current_user');
  });
});

describe('assertRlsRoleSafeInProduction', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRlsEnabled = process.env.COLLECTRX_RLS_ENABLED;
  const originalGuardBypass = process.env.COLLECTRX_RLS_ROLE_GUARD;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.COLLECTRX_RLS_ENABLED = originalRlsEnabled;
    process.env.COLLECTRX_RLS_ROLE_GUARD = originalGuardBypass;
    vi.restoreAllMocks();
  });

  it('does not query or exit outside production', async () => {
    process.env.NODE_ENV = 'development';
    const prisma = mockPrismaWithRoleFlags([{ rolsuper: true, rolbypassrls: true }]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await assertRlsRoleSafeInProduction(prisma);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits in production when the connected role is unsafe', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COLLECTRX_RLS_ROLE_GUARD;
    const prisma = mockPrismaWithRoleFlags([{ rolsuper: true, rolbypassrls: false }]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await assertRlsRoleSafeInProduction(prisma);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some(([msg]) => String(msg).includes('FATAL'))).toBe(true);
  });

  it('does not exit in production for a safe role', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COLLECTRX_RLS_ROLE_GUARD;
    const prisma = mockPrismaWithRoleFlags([{ rolsuper: false, rolbypassrls: false }]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await assertRlsRoleSafeInProduction(prisma);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('honors the COLLECTRX_RLS_ROLE_GUARD=0 escape hatch even for an unsafe role', async () => {
    process.env.NODE_ENV = 'production';
    process.env.COLLECTRX_RLS_ROLE_GUARD = '0';
    const prisma = mockPrismaWithRoleFlags([{ rolsuper: true, rolbypassrls: true }]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await assertRlsRoleSafeInProduction(prisma);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when the diagnostic query itself fails — this guard must not become a new outage cause', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COLLECTRX_RLS_ROLE_GUARD;
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('permission denied for pg_roles')) } as unknown as PrismaClient;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await assertRlsRoleSafeInProduction(prisma);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
