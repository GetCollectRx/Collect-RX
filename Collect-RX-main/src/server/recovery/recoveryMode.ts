import type { PrismaClient } from '@prisma/client';

export type PracticeRecoveryMode = 'CSV_FIRST' | 'PMS_WRITEBACK';

const DEFAULT_MODE: PracticeRecoveryMode = 'CSV_FIRST';

export async function getPracticeRecoveryMode(
  prisma: PrismaClient,
  practiceId: string,
): Promise<PracticeRecoveryMode> {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { recoveryMode: true },
  });
  const mode = practice?.recoveryMode;
  return mode === 'PMS_WRITEBACK' ? 'PMS_WRITEBACK' : DEFAULT_MODE;
}

export function isCsvFirstRecovery(mode: PracticeRecoveryMode): boolean {
  return mode !== 'PMS_WRITEBACK';
}

/** Human label for payment-wait routes — CSV-first practices confirm via re-import. */
export function paymentConfirmationLabel(mode: PracticeRecoveryMode): string {
  return mode === 'PMS_WRITEBACK'
    ? 'Await PMS payment confirmation'
    : 'Await CSV balance confirmation';
}

export function paymentConfirmationHint(mode: PracticeRecoveryMode): string {
  return mode === 'PMS_WRITEBACK'
    ? 'CollectRx waits for the PMS sync webhook to confirm the outstanding balance dropped.'
    : 'Re-import your claims CSV when the carrier payment posts. CollectRx verifies recovery from the balance change — no PMS writeback required.';
}
