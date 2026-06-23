-- CreateTable: invite_tokens — single-use email invite tokens for staff onboarding
CREATE TABLE "InviteToken" (
    "id"         TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "email"      TEXT NOT NULL,
    "role"       "PracticeRole" NOT NULL,
    "token"      TEXT NOT NULL,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "usedAt"     TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InviteToken_token_key" ON "InviteToken"("token");

-- CreateIndex
CREATE INDEX "InviteToken_token_idx" ON "InviteToken"("token");

-- CreateIndex
CREATE INDEX "InviteToken_practiceId_idx" ON "InviteToken"("practiceId");

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_practiceId_fkey"
    FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
