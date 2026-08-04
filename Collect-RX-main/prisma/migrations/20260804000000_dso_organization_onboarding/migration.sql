-- DropIndex
DROP INDEX "organization_practices_practice_id_idx";

-- DropIndex
DROP INDEX "organization_practices_organization_id_practice_id_key";

-- CreateTable
CREATE TABLE "organization_invite_tokens" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invitee_email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_invite_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_invite_tokens_token_key" ON "organization_invite_tokens"("token");

-- CreateIndex
CREATE INDEX "organization_invite_tokens_token_idx" ON "organization_invite_tokens"("token");

-- CreateIndex
CREATE INDEX "organization_invite_tokens_organization_id_idx" ON "organization_invite_tokens"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_practices_practice_id_key" ON "organization_practices"("practice_id");

-- CreateIndex
CREATE INDEX "organization_practices_organization_id_idx" ON "organization_practices"("organization_id");

-- AddForeignKey
ALTER TABLE "organization_invite_tokens" ADD CONSTRAINT "organization_invite_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

