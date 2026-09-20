-- patient_id held the PMS record ID; the pre-visit pipeline was incorrectly
-- writing the PIIVault token into it instead of patient_token. Now that the
-- pre-visit writer only sets patient_token, patient_id has no writer for
-- pre-visit-created rows and must be nullable.
ALTER TABLE "eligibility_snapshots" ALTER COLUMN "patient_id" DROP NOT NULL;
