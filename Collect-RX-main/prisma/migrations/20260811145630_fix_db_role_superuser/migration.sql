-- Fix production database role: revoke superuser to enable row-level security
-- PostgreSQL silently disables RLS when the current role is a superuser,
-- causing the app startup check to fail.

-- First, ensure we're not a superuser so we can modify the role
-- This runs as the postgres admin role during deployment
ALTER ROLE collect_rx NOSUPERUSER;

-- Verify the change worked
-- The app startup code will detect if this still fails
