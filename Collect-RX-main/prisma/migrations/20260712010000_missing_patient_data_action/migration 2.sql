-- Missing patient data gate: claims lacking required PHI fields (patient name,
-- DOB, subscriber ID) raise a BLOCKING recovery action so the practice sees
-- exactly which funds are stuck and why, instead of the claim silently
-- deferring in the call queue.
ALTER TYPE "recovery_action_type" ADD VALUE IF NOT EXISTS 'MISSING_PATIENT_DATA';
