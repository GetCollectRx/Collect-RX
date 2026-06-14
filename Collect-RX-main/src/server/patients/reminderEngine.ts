/**
 * Legacy patient reminder engine — disabled. CollectRx contacts insurance carriers only.
 */

export async function runReminderCycle(): Promise<{ sent: number; skipped: number; error?: string }> {
  return { sent: 0, skipped: 0 };
}

export function startReminderEngine(): void {
  console.log('[reminderEngine] disabled — insurance-carrier recovery only');
}
