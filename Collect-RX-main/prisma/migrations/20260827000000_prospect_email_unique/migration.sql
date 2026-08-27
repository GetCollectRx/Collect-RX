-- Add unique constraint to prospect email field
-- This prevents duplicate prospects from being created during discovery
-- for the same email address across all campaigns and routines.
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_email_key" UNIQUE ("email");
