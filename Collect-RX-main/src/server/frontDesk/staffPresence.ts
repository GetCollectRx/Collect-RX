/**
 * Staff presence: who can take a live carrier rep right now.
 *
 * Human-assisted calls hand a live representative to staff. The dispatch guard needs a ready person
 * before it dials, and calls in flight never exceed the number of ready people (PRD Epic 4). A
 * presence older than the freshness window counts as OFF so a forgotten toggle never means ready.
 */
import type { PrismaClient, StaffPresenceStatus } from '@prisma/client';

/** How long a presence stays valid without being refreshed. */
export const PRESENCE_FRESH_MS = 4 * 60 * 60 * 1000;

export interface PresenceEntry {
  userId: string;
  displayName: string;
  status: StaffPresenceStatus;
  updatedAt: string;
  /** False once the entry is older than the freshness window; such an entry counts as OFF. */
  fresh: boolean;
}

export function isStatusReady(status: StaffPresenceStatus, updatedAt: Date, now: Date = new Date()): boolean {
  return status === 'AVAILABLE' && now.getTime() - updatedAt.getTime() < PRESENCE_FRESH_MS;
}

export async function setPresence(
  prisma: PrismaClient,
  params: { practiceId: string; userId: string; status: StaffPresenceStatus },
): Promise<void> {
  const { practiceId, userId, status } = params;
  await prisma.staffPresence.upsert({
    where: { practiceId_userId: { practiceId, userId } },
    create: { practiceId, userId, status },
    update: { status },
  });
}

/** People at the practice who are ready to take a rep now. */
export async function readyStaffCount(prisma: PrismaClient, practiceId: string, now: Date = new Date()): Promise<number> {
  return prisma.staffPresence.count({
    where: {
      practiceId,
      status: 'AVAILABLE',
      updatedAt: { gt: new Date(now.getTime() - PRESENCE_FRESH_MS) },
      user: { isActive: true },
    },
  });
}

/** Human-assisted calls currently open for the practice. */
export async function inFlightHumanAssistedCalls(prisma: PrismaClient, practiceId: string): Promise<number> {
  return prisma.callAttempt.count({
    where: { completedAt: null, isHumanAssisted: true, claim: { practiceId } },
  });
}

export async function listPresence(prisma: PrismaClient, practiceId: string, now: Date = new Date()): Promise<PresenceEntry[]> {
  const rows = await prisma.staffPresence.findMany({
    where: { practiceId, user: { isActive: true } },
    include: { user: { select: { displayName: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.user.displayName,
    status: r.status,
    updatedAt: r.updatedAt.toISOString(),
    fresh: now.getTime() - r.updatedAt.getTime() < PRESENCE_FRESH_MS,
  }));
}

/** Whether a rep who just answered can be handed to staff: someone is ready and has capacity. */
export function canTakeRep(ready: number, inFlight: number): boolean {
  return ready > 0 && inFlight <= ready;
}

/** Whether another call may be dialed: strictly more ready people than calls already in flight. */
export function hasCapacityToDial(ready: number, inFlight: number): boolean {
  return ready > inFlight;
}
