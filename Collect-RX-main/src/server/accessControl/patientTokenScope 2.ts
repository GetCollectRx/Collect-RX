import type { PrismaClient } from '@prisma/client';

/**
 * Returns true when `patientToken` is referenced by at least one row owned by
 * the practice. Prevents cross-tenant detokenization via pre-visit endpoints.
 */
export async function patientTokenBelongsToPractice(
  prisma: PrismaClient,
  practiceId: string,
  patientToken: string,
): Promise<boolean> {
  const token = patientToken.trim();
  if (!token) return false;

  const [claim, verification, appointment, cdcpCase, adjudication] = await Promise.all([
    prisma.insuranceClaim.findFirst({ where: { practiceId, patientToken: token }, select: { id: true } }),
    prisma.appointmentVerification.findFirst({ where: { practiceId, patientToken: token }, select: { id: true } }),
    prisma.scheduledAppointment.findFirst({ where: { practiceId, patientToken: token }, select: { id: true } }),
    prisma.cdcpReconsiderationCase.findFirst({ where: { practiceId, patientToken: token }, select: { id: true } }),
    prisma.adjudicationEvent.findFirst({ where: { practiceId, patientToken: token }, select: { id: true } }),
  ]);

  return Boolean(claim || verification || appointment || cdcpCase || adjudication);
}
