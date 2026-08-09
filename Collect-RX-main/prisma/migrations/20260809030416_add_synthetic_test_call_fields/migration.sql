-- Rep Simulator (Kill Test 1) support columns on call_attempts.
-- Nullable / defaulted so this is fully backward-compatible: existing rows
-- and real call-dispatch code paths are unaffected. isSynthetic defaults to
-- false, so any code that does not explicitly set it keeps writing real
-- (non-test) call attempts exactly as before.
--
-- NOTE: this migration is scoped ONLY to the additive change below. The
-- schema.prisma file in this repo already had pre-existing drift against the
-- migration history (a removed Phase5KpiSnapshot model and prospects column
-- changes with no corresponding migration) before this change was made;
-- `prisma migrate dev --create-only` bundles that drift into its diff by
-- default, but it is unrelated to this task and was intentionally stripped
-- out here so this migration stays strictly additive.
-- AlterTable
ALTER TABLE "call_attempts" ADD COLUMN     "is_synthetic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rep_persona" TEXT,
ADD COLUMN     "test_run_id" TEXT;

-- CreateIndex
CREATE INDEX "call_attempts_test_run_id_idx" ON "call_attempts"("test_run_id");
