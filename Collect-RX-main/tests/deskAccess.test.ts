import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { AuthJwtPayload, PracticeRole } from '../src/server/accessControl/types.js';
import { canConnectToDesk } from '../src/server/frontDesk/deskAccess.js';

const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn() }));

vi.mock('../src/server/services/practiceSettingsService.js', () => ({ getPracticeSettings: getSettings }));
vi.mock('../src/server/db/rlsContext.js', () => ({
  runWithRlsBypass: <T>(fn: () => T) => fn(),
}));

const prisma = {} as PrismaClient;

function auth(role: PracticeRole, userId = 'user-1', practiceId = 'practice-1'): AuthJwtPayload {
  return { role, userId, practiceId, phiAccess: true };
}

describe('canConnectToDesk', () => {
  it('always admits front desk users, without looking at the settings', async () => {
    await expect(canConnectToDesk(prisma, auth('front_desk'))).resolves.toBe(true);
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('admits the designated individual whatever their title', async () => {
    getSettings.mockResolvedValue({ designatedIndividualUserId: 'user-1' });
    await expect(canConnectToDesk(prisma, auth('office_manager'))).resolves.toBe(true);
    await expect(canConnectToDesk(prisma, auth('practice_owner'))).resolves.toBe(true);
    await expect(canConnectToDesk(prisma, auth('accountant'))).resolves.toBe(true);
  });

  it('keeps out someone who is not the designated individual', async () => {
    getSettings.mockResolvedValue({ designatedIndividualUserId: 'someone-else' });
    await expect(canConnectToDesk(prisma, auth('office_manager'))).resolves.toBe(false);
  });

  it('keeps everyone else out when the practice has not designated anyone', async () => {
    getSettings.mockResolvedValue({});
    await expect(canConnectToDesk(prisma, auth('practice_owner'))).resolves.toBe(false);
  });

  it('reads the settings of the practice in the token, not another practice', async () => {
    getSettings.mockClear();
    getSettings.mockResolvedValue({ designatedIndividualUserId: 'user-1' });
    await canConnectToDesk(prisma, auth('office_manager', 'user-1', 'practice-7'));
    expect(getSettings).toHaveBeenCalledWith(prisma, 'practice-7');
  });

  it('keeps out a platform developer session, which has no practice', async () => {
    const platform: AuthJwtPayload = { role: 'platform_dev', userId: 'platform-dev', practiceId: null, phiAccess: false };
    await expect(canConnectToDesk(prisma, platform)).resolves.toBe(false);
  });
});
