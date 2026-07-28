/**
 * Daily digest email job — runs once per day, summarizes claim recovery metrics for all practices.
 */

import type { Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { sendDailyDigestEmail, computeDigestData } from '../email/dailyDigestEmail.js';

export async function processDailyDigestJob(job: Job): Promise<string> {
  try {
    const practices = await prisma.practice.findMany({
      select: {
        id: true,
        name: true,
        users: {
          where: { role: 'practice_owner', isActive: true },
          select: { email: true, displayName: true },
        },
      },
    });

    let sent = 0;
    let failed = 0;

    for (const practice of practices) {
      if (practice.users.length === 0) {
        continue;
      }

      try {
        const digestData = await computeDigestData(prisma, practice.id);

        for (const user of practice.users) {
          try {
            await sendDailyDigestEmail({
              toEmail: user.email,
              displayName: user.displayName || user.email,
              data: digestData,
            });
            sent += 1;
          } catch (err) {
            console.error(`[dailyDigestJob] Failed to send to ${user.email}:`, err);
            failed += 1;
          }
        }
      } catch (err) {
        console.error(`[dailyDigestJob] Failed to compute digest for ${practice.name}:`, err);
        failed += 1;
      }
    }

    const msg = `Daily digest sent to ${sent} practice owner(s)${failed > 0 ? `, ${failed} failed` : ''}`;
    console.log(`[dailyDigestJob] ${msg}`);
    job.progress(100);

    return msg;
  } catch (err) {
    console.error('[dailyDigestJob]', err);
    throw err;
  }
}
