/**
 * Scheduled appointment ingest and verification sweep.
 */
import type { CarrierId, PrismaClient } from '@prisma/client';
import { verifyBeforeAppointment, type PreVisitParams } from './appointmentVerification.js';
import type { PredetArtifact } from './predetSubmissionRules.js';

export interface AppointmentIngestRow {
  patientToken: string;
  carrierId: CarrierId;
  procedureCodes: string[];
  appointmentAt: Date;
  pmsSource?: string;
  pmsAppointmentId?: string;
  artifactAttestations?: Partial<Record<PredetArtifact, boolean>>;
}

export async function ingestScheduledAppointments(
  prisma: PrismaClient,
  practiceId: string,
  rows: AppointmentIngestRow[],
): Promise<{ ingested: number; verified: number }> {
  let ingested = 0;
  let verified = 0;

  for (const row of rows) {
    const existing = row.pmsSource && row.pmsAppointmentId
      ? await prisma.scheduledAppointment.findUnique({
          where: {
            practiceId_pmsSource_pmsAppointmentId: {
              practiceId,
              pmsSource: row.pmsSource,
              pmsAppointmentId: row.pmsAppointmentId,
            },
          },
        })
      : null;

    let appointmentId: string;
    if (existing) {
      appointmentId = existing.id;
      await prisma.scheduledAppointment.update({
        where: { id: existing.id },
        data: {
          procedureCodes: row.procedureCodes,
          appointmentAt: row.appointmentAt,
          artifactAttestations: row.artifactAttestations ?? undefined,
        },
      });
    } else {
      const created = await prisma.scheduledAppointment.create({
        data: {
          practiceId,
          patientToken: row.patientToken,
          carrierId: row.carrierId,
          procedureCodes: row.procedureCodes,
          appointmentAt: row.appointmentAt,
          pmsSource: row.pmsSource ?? null,
          pmsAppointmentId: row.pmsAppointmentId ?? null,
          artifactAttestations: row.artifactAttestations ?? undefined,
        },
      });
      appointmentId = created.id;
      ingested++;
    }

    const params: PreVisitParams = {
      practiceId,
      patientToken: row.patientToken,
      carrierId: row.carrierId,
      procedureCodes: row.procedureCodes,
      appointmentAt: row.appointmentAt,
      artifactAttestations: row.artifactAttestations,
      scheduledAppointmentId: appointmentId,
    };

    const result = await verifyBeforeAppointment(prisma, params);
    await prisma.scheduledAppointment.update({
      where: { id: appointmentId },
      data: {
        verificationId: (
          await prisma.appointmentVerification.findFirst({
            where: { practiceId, patientToken: row.patientToken, appointmentAt: row.appointmentAt },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          })
        )?.id,
      },
    });
    if (result) verified++;
  }

  return { ingested, verified };
}

const SWEEP_HORIZON_MS = 48 * 60 * 60 * 1000;

/**
 * Global cron dispatcher (called from the hourly rules-engine tick and the
 * worker's APPOINTMENT_VERIFICATION_SWEEP job) — intentionally queries across
 * all practices in one batch rather than per-tenant, mirroring
 * `runDailyArCloseAllPractices`. Not tenant-facing; do not call this from a
 * per-practice request path.
 */
export async function sweepUpcomingAppointmentsAcrossPractices(prisma: PrismaClient): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + SWEEP_HORIZON_MS);

  const due = await prisma.scheduledAppointment.findMany({
    where: {
      appointmentAt: { gte: now, lte: horizon },
      verificationId: null,
    },
    take: 50,
  });

  let count = 0;
  for (const appt of due) {
    await verifyBeforeAppointment(prisma, {
      practiceId: appt.practiceId,
      patientToken: appt.patientToken,
      carrierId: appt.carrierId,
      procedureCodes: appt.procedureCodes,
      appointmentAt: appt.appointmentAt,
      artifactAttestations: (appt.artifactAttestations as PreVisitParams['artifactAttestations']) ?? undefined,
      scheduledAppointmentId: appt.id,
    });
    const latest = await prisma.appointmentVerification.findFirst({
      where: {
        practiceId: appt.practiceId,
        patientToken: appt.patientToken,
        appointmentAt: appt.appointmentAt,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (latest) {
      await prisma.scheduledAppointment.update({
        where: { id: appt.id },
        data: { verificationId: latest.id },
      });
    }
    count++;
  }

  return count;
}
