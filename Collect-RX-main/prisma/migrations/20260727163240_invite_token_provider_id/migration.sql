-- associate_dentist invites need to carry providerId onto the User row that
-- accept-invite creates — previously only POST /api/auth/users (a route with
-- no UI caller) could set it, so invited associate dentists always got
-- providerId: null and their query scoping silently broke.

ALTER TABLE "InviteToken" ADD COLUMN "provider_id" TEXT;
