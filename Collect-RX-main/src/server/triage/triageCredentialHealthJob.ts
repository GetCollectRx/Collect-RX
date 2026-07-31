import type { PrismaClient } from '@prisma/client';
import { runWithPracticeRls } from '../db/rlsContext.js';
import { checkTriageCredentialHealth } from './triageCredentialService.js';

/** Runs local encrypted-payload integrity checks only; no external transport. */
export async function runTriageCredentialHealthJob(prisma: PrismaClient): Promise<number> {
  const credentials = await prisma.triageCredential.findMany({ select: { practiceId: true } });
  let checked = 0;
  for (const { practiceId } of credentials) {
    await runWithPracticeRls(practiceId, async () => {
      await checkTriageCredentialHealth(prisma, {
        practiceId,
        actor: 'worker:triage_credential_health',
      });
      checked += 1;
    });
  }
  return checked;
}
