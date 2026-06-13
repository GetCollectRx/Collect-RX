import type { Prisma, PrismaClient } from '@prisma/client';

export async function logProspectActivity(
  prisma: PrismaClient,
  prospectId: string,
  type: string,
  summary: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.prospectActivity.create({
    data: {
      prospectId,
      type,
      summary,
      metadata: metadata ? (metadata as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
}
