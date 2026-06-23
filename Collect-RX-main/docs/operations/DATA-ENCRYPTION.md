# CollectRx — data encryption

This document explains how sensitive data is protected for HIPAA/PHIPA-style expectations: **encryption in transit**, **encryption at rest** (host + optional application layer), **key management**, and **PHIPA audit logging** for crypto operations.

## 1. Encryption in transit (network)

| Path | Mechanism |
|------|-----------|
| Browser ↔ API | **HTTPS** in production. Railway (or your reverse proxy) terminates TLS 1.2+ to clients. The API enables **HSTS** and related headers via **Helmet** in `src/server/index.ts` (CSP is disabled for the Vite SPA shell — tighten if this process serves JSON-only). |
| API / worker ↔ PostgreSQL | **TLS to Postgres** is **required in production**: `DATABASE_URL` must include `sslmode=require`, `sslmode=verify-ca`, `sslmode=verify-full`, or `ssl=true`. The API and BullMQ worker call `assertPostgresTlsInProduction()` at startup. |
| API ↔ Redis | Use **`rediss://`** when your provider supports TLS. Local `redis://` is normal for development only. |
| Webhooks (Vapi, Stripe, SendGrid, Twilio) | **Provider signatures** (HMAC, Ed25519, etc.); transport is HTTPS to your origin. |
| Outbound HTTP(S) from Node | Do **not** disable certificate verification (`rejectUnauthorized: false`) for third-party APIs. |

**Optional — TLS terminated inside Node:** If you set **`TLS_KEY_PATH`** and **`TLS_CERT_PATH`** (PEM files), the API uses `https.createServer` with **min TLS 1.2**, **max TLS 1.3**, and a **restricted ECDHE cipher list** (`src/server/tls/nodeHttpsSettings.ts`). On Railway, leave these unset so the platform terminates TLS and the app listens on HTTP behind the proxy.

## 2. Encryption at rest (storage)

| Layer | Responsibility |
|-------|------------------|
| PostgreSQL data files | **Transparent Data Encryption (TDE)** and volume encryption are **provider features** (e.g. encrypted RDS, Railway managed disks). Enable in the host console; the app does not replace TDE. |
| Secrets (API keys, `DATABASE_URL`, JWT secret) | Prefer **AWS Systems Manager Parameter Store `SecureString`** (KMS-encrypted) via `src/config/secrets.js`, or your cloud KMS + environment injection. Never commit `.env`. |
| Backups & exports | Treat CSV/database dumps as **sensitive**; store only in encrypted buckets with strict IAM. |

### Application-layer PHI (AES-256-GCM)

For fields you choose to encrypt before persistence:

- **Implementation:** `src/server/crypto/phiAesGcm.ts` — **AES-256-GCM** via Node `crypto` (12-byte IV, 16-byte auth tag; unique IV per encryption).
- **Audited API:** `src/server/crypto/phiAtRest.ts` — `encryptPhiAtRest` / `decryptPhiAtRest` (and `*PayloadV1` helpers) call **`logPhiCryptoAccess`** so every encrypt/decrypt emits a structured **`PHI_CRYPTO_ACCESS`** line (operation, record id, optional `fieldKey` / `practiceId` / `actor`, outcome). **Never** logs plaintext, ciphertext, IV, or auth tag.
- **Key material:** `PHI_ENCRYPTION_KEY` — **exactly 32 bytes** as **64 hex characters** or **standard base64** encoding 32 raw bytes. In production, load from **AWS KMS / Azure Key Vault / GCP KMS** (or inject the raw 32-byte secret from your host secret manager). Do not commit keys to git.
- **Feature flag:** `PHI_ENCRYPTION_AT_REST=1` — when set with `NODE_ENV=production`, the server **refuses to start** unless `PHI_ENCRYPTION_KEY` is valid (`assertPhiEncryptionAtRestConfigured`).

Persist ciphertext as JSON using `EncryptedPhiPayloadV1` (`v: 1`, `iv`, `encryptedText`, `authTag` — hex strings) in a `String` / `Json` column you add for that field.

CollectRx also uses **AES-256-GCM** for specific **CDCP** payloads (`src/server/services/cdcp/cdanetSubmission.ts`) and **tokenization** for the voice boundary (`src/services/pii-vault.ts`).

## 3. Rows that are still plaintext at the ORM layer

Unless you route a column through `phiAtRest`, Prisma stores values as **normal columns**. Plan migrations and read paths if you adopt field-level encryption for specific attributes (search and indexing implications).

## 4. Verification checklist

1. **Production `DATABASE_URL`**: `sslmode=require` (or stricter) or `ssl=true`.
2. **`node scripts/check-deploy-env.mjs`** with `NODE_ENV=production`: required vars + Postgres TLS + `PHI_ENCRYPTION_KEY` when `PHI_ENCRYPTION_AT_REST` is enabled.
3. **Cookies / sessions**: `Secure` cookies when needed (`AUTH_COOKIE_CROSS_SITE` per `.env.example`).
4. **Helmet / HSTS**: enabled on the main API (`src/server/index.ts`).
5. **Optional in-process HTTPS**: PEM paths + strict TLS options in `nodeHttpsSettings.ts`.

## 5. Related docs

- `docs/audit/security-audit.md` — transport headers, CORS, PHI boundaries.
- `Collect-RX-main/.env.example` — environment variable reference.
- `Collect-RX-main/DEPLOY.md` — Railway variable wiring.
- `docs/compliance/LAUNCH-DATA-PROTECTION-CA-US.md` — Canada/US launch scrutiny: how technical controls map to typical regulatory/customer review (not legal advice).
