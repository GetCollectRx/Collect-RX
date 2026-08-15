-- CreateTable revoked_tokens for JWT session revocation (logout/session invalidation)
CREATE TABLE "revoked_tokens" (
    "jti" VARCHAR(255) NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revoked_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex on expires_at for cleanup of expired entries
CREATE INDEX "revoked_tokens_expires_at_idx" ON "revoked_tokens"("expires_at");
