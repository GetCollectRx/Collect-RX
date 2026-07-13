/**
 * CSV appointment import for pre-visit clearance (tokenizes PHI, runs verification).
 */
import type { CarrierId, PrismaClient } from '@prisma/client';
import { getCell } from '../pms/parseExportRows.js';
import { mapToCarrierId } from '../pms/carrierMap.js';
import { piiVault, type PatientPHI } from '../../pii-vault.js';
import { ingestScheduledAppointments, type AppointmentIngestRow } from '../preVisit/appointmentIngest.js';

export interface AppointmentCsvImportResult {
  ingested: number;
  verified: number;
  skipped: number;
  errors: { row: number; error: string }[];
}

function parseProcedureCodes(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^D\d{4}$/.test(c));
}

function buildPatientPhi(raw: Record<string, unknown>): PatientPHI {
  const first = getCell(raw, 'Patient First Name', 'First Name', 'first_name', 'Given') ?? '';
  const last = getCell(raw, 'Patient Last Name', 'Last Name', 'last_name', 'Surname') ?? '';
  return {
    patientName: [first, last].filter(Boolean).join(' ') || 'Unknown',
    dateOfBirth: getCell(raw, 'DOB', 'Date of Birth', 'patient_dob', 'Birth Date') ?? '',
    subscriberId: getCell(raw, 'Subscriber ID', 'Member ID', 'subscriber_id', 'Certificate') ?? '',
    groupPolicyNumber: getCell(raw, 'Group Number', 'Policy', 'group_policy') ?? '',
  };
}

export async function importAppointmentCsvRows(
  prisma: PrismaClient,
  practiceId: string,
  records: Record<string, unknown>[],
): Promise<AppointmentCsvImportResult> {
  const result: AppointmentCsvImportResult = {
    ingested: 0,
    verified: 0,
    skipped: 0,
    errors: [],
  };

  const batch: AppointmentIngestRow[] = [];

  records.forEach((raw, index) => {
    try {
      const appointmentRaw = getCell(raw,
        'Appointment Date', 'Appt Date', 'appointment_at', 'Scheduled',
      );
      if (!appointmentRaw) {
        result.skipped += 1;
        return;
      }
      const appointmentAt = new Date(appointmentRaw);
      if (Number.isNaN(appointmentAt.getTime())) {
        result.errors.push({ row: index + 1, error: 'Invalid appointment date' });
        return;
      }

      const carrierName = getCell(raw, 'Carrier', 'Insurance', 'Payer') ?? '';
      const carrierId = mapToCarrierId(carrierName);
      if (!carrierId) {
        result.errors.push({ row: index + 1, error: `Unrecognized carrier: ${carrierName || '(blank)'}` });
        return;
      }

      const procedureCodes = parseProcedureCodes(
        getCell(raw, 'Procedures', 'CDT Codes', 'procedure_codes', 'Codes'),
      );
      if (procedureCodes.length === 0) {
        result.errors.push({ row: index + 1, error: 'No valid CDT procedure codes' });
        return;
      }

      const patientToken = piiVault.tokenize(buildPatientPhi(raw), 'appointment-csv', practiceId);
      const pmsAppointmentId = getCell(raw, 'Appointment ID', 'Appt ID', 'appointment_id') ?? undefined;

      batch.push({
        patientToken,
        carrierId: carrierId as CarrierId,
        procedureCodes,
        appointmentAt,
        pmsSource: 'csv',
        pmsAppointmentId,
      });
    } catch (err) {
      result.errors.push({ row: index + 1, error: (err as Error).message });
    }
  });

  if (batch.length > 0) {
    const ingest = await ingestScheduledAppointments(prisma, practiceId, batch);
    result.ingested = ingest.ingested;
    result.verified = ingest.verified;
  }

  return result;
}
