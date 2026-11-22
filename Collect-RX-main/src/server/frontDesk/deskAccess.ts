import type { PrismaClient } from '@prisma/client';
import { authPracticeId, authUserId, getUserRole, type AuthJwtPayload } from '../accessControl/types.js';
import { runWithRlsBypass } from '../db/rlsContext.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';

/**
 * Who may receive live desk events, including the "rep is on the line" alert.
 *
 * Front desk users always may. Anyone else may only when their practice has
 * designated them, so the alert follows the person the practice chose and not
 * a job title: a designated office manager or owner gets it, an undesignated
 * one does not.
 */
export async function canConnectToDesk(prisma: PrismaClient, auth: AuthJwtPayload): Promise<boolean> {
  if (getUserRole(auth) === 'front_desk') return true;
  const practiceId = authPracticeId(auth);
  const userId = authUserId(auth);
  if (!practiceId || !userId) return false;
  const settings = await runWithRlsBypass(() => getPracticeSettings(prisma, practiceId));
  return settings.designatedIndividualUserId === userId;
}
