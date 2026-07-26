-- Migration: 20260626120000_appointment_verifications
--
-- Creates appointment_verifications — the persisted GREEN/YELLOW/RED outcome
-- of verifyBeforeAppointment() (src/server/preVisit/appointmentVerification.ts),
-- run ahead of a scheduled appointment.

CREATE TABLE "appointment_verifications" (
  "id"                  TEXT        NOT NULL,
  "practice_id"         TEXT        NOT NULL,
  "patient_token"       TEXT        NOT NULL,
  "carrier_id"          "carrier_id" NOT NULL,
  "procedure_codes"     TEXT[]      NOT NULL,
  "appointment_at"      TIMESTAMP(3) NOT NULL,
  "status"              TEXT        NOT NULL,
  "reason"              TEXT,
  "cdcp_days_remaining" INTEGER,
  "enqueued_job_id"     TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "appointment_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "appointment_verifications_practice_id_patient_token_idx"
  ON "appointment_verifications" ("practice_id", "patient_token");

CREATE INDEX "appointment_verifications_practice_id_appointment_at_idx"
  ON "appointment_verifications" ("practice_id", "appointment_at");
