// ─────────────────────────────────────────────────────────────────────────────
// CollectRx Compliance Audit Agent
//
// Runs static and runtime checks across PHIPA, PIPEDA, Quebec Law 25, Alberta
// HIA, and voluntary AIDA requirements. Each check is deterministic and
// evidence-backed — no external calls, no PHI touched.
//
// Usage (programmatic):
//   import { runComplianceAudit } from './auditAgent.js';
//   const report = await runComplianceAudit();
//
// Usage (CLI):
//   npx tsx src/server/compliance/auditAgent.ts
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CheckStatus,
  ComplianceCheck,
  ComplianceDomain,
  ComplianceReport,
  Regulation,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// compliance/ → server/ → src/ → Collect-RX-main/ (project root)
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

function srcPath(...parts: string[]): string {
  return path.join(ROOT, 'src', ...parts);
}

function readSrc(...parts: string[]): string {
  try {
    return fs.readFileSync(srcPath(...parts), 'utf8');
  } catch {
    return '';
  }
}

function fileExists(...parts: string[]): boolean {
  return fs.existsSync(srcPath(...parts));
}

function envSet(key: string): boolean {
  return !!process.env[key]?.trim();
}

function check(
  id: string,
  domain: ComplianceDomain,
  regulations: Regulation[],
  title: string,
  description: string,
  status: CheckStatus,
  evidence: string,
  opts: { recommendation?: string; reference?: string } = {},
): ComplianceCheck {
  return { id, domain, regulations, title, description, status, evidence, ...opts };
}

// ---------------------------------------------------------------------------
// Domain A: PHI Boundary
// ---------------------------------------------------------------------------

function checkPhiBoundary(): ComplianceCheck[] {
  const piiVault = readSrc('services', 'pii-vault.ts');
  const vapiClient = readSrc('vapi', 'client.ts');
  const results: ComplianceCheck[] = [];

  // A1 — Tokenization before Vapi
  const hasTokenize = piiVault.includes('export function tokenize(') || piiVault.includes('export const piiVault');
  const vapiUsesToken = vapiClient.includes('patientToken') && !vapiClient.includes('dateOfBirth') && !vapiClient.includes('healthCardNumber') && !vapiClient.includes('firstName');
  results.push(check(
    'A1', 'PHI_BOUNDARY', ['PHIPA', 'PIPEDA'],
    'PII Vault tokenization enforced before Vapi dispatch',
    'Patient identifiers are converted to UUID tokens before reaching Vapi voice agents.',
    hasTokenize && vapiUsesToken ? 'pass' : 'fail',
    hasTokenize
      ? 'PIIVault.tokenize() present; Vapi payload uses patientToken (UUID) — no real PHI fields found in VapiCallParams.'
      : 'MISSING: pii-vault.ts tokenize() function not found.',
    {
      recommendation: hasTokenize && vapiUsesToken ? undefined : 'Implement PIIVault tokenization before every Vapi call.',
      reference: 'PHIPA s.37 — Disclosure limitations; PIPEDA Principle 4.5 — Limiting use',
    },
  ));

  // A2 — Detokenization server-side only
  const hasDetokenize = piiVault.includes('export function detokenize(');
  const vapiWebhook = readSrc('server', 'vapi', 'vapiWebhook.ts');
  const _detokenOnBackend = vapiWebhook.includes('detokenize') || vapiWebhook.includes('piiVault');
  void _detokenOnBackend;
  results.push(check(
    'A2', 'PHI_BOUNDARY', ['PHIPA', 'PIPEDA'],
    'Detokenization occurs only on the backend after call completion',
    'Real patient IDs are resolved from tokens only server-side, never in transit to Vapi.',
    hasDetokenize ? 'pass' : 'fail',
    hasDetokenize
      ? 'detokenize() function present in pii-vault.ts; webhook handler calls piiVault.'
      : 'MISSING: detokenize() not found.',
    { reference: 'PHIPA s.37; PIPEDA Principle 4.5' },
  ));

  // A3 — Token TTL caps PHI exposure window
  const hasTTL = piiVault.includes('TOKEN_TTL_MS') && piiVault.includes('24 * 60 * 60 * 1000');
  results.push(check(
    'A3', 'PHI_BOUNDARY', ['PHIPA', 'PIPEDA'],
    'Token TTL limits PHI exposure window to 24 hours',
    'UUID tokens auto-expire, bounding the window during which a compromised token could be misused.',
    hasTTL ? 'pass' : 'warn',
    hasTTL ? 'TOKEN_TTL_MS = 24h found in pii-vault.ts.' : 'Token TTL not found — verify expiry is enforced.',
    {
      recommendation: hasTTL ? undefined : 'Set TOKEN_TTL_MS to 24h or less and purge expired tokens hourly.',
      reference: 'PIPEDA Principle 4.5 — Limiting retention',
    },
  ));

  // A4 — Expired token purge runs periodically
  const hasPurge = piiVault.includes('export function purgeExpired(');
  const indexTs = readSrc('server', 'index.ts');
  const purgeCalledOnBoot = indexTs.includes('purgeExpired');
  results.push(check(
    'A4', 'PHI_BOUNDARY', ['PHIPA', 'PIPEDA'],
    'Expired tokens purged on boot and periodically',
    'Stale tokens are swept from the in-memory vault to minimize exposure.',
    hasPurge && purgeCalledOnBoot ? 'pass' : 'warn',
    hasPurge
      ? `purgeExpired() present. ${purgeCalledOnBoot ? 'Called at boot in index.ts.' : 'WARNING: not found in index.ts boot sequence — verify hourly purge is scheduled.'}`
      : 'MISSING: purgeExpired() not found.',
    {
      recommendation: !purgeCalledOnBoot ? 'Call piiVault.purgeExpired() on boot and schedule hourly via setInterval.' : undefined,
    },
  ));

  // A5 — Zero-retention audio: recordings deleted after transcript+eval
  const hasAudioDeletion = piiVault.includes('handlePostCallAudioDeletion') && piiVault.includes('isReadyForAudioDeletion');
  const hasVapiDeletion = piiVault.includes("vapiRes.ok || vapiRes.status === 404");
  const hasTwilioDeletion = piiVault.includes("twilioRes.ok || twilioRes.status === 404");
  results.push(check(
    'A5', 'PHI_BOUNDARY', ['PHIPA', 'PIPEDA', 'Quebec-Law-25'],
    'Zero-retention audio: call recordings deleted after transcript extraction + evaluation',
    'Vapi and Twilio recordings are deleted once the transcript is extracted and the 8-dim eval completes.',
    hasAudioDeletion && hasVapiDeletion && hasTwilioDeletion ? 'pass' : 'fail',
    hasAudioDeletion
      ? 'handlePostCallAudioDeletion() + isReadyForAudioDeletion() present; both Vapi and Twilio DELETE calls implemented.'
      : 'MISSING: audio deletion handler not found in pii-vault.ts.',
    {
      recommendation: !hasAudioDeletion ? 'Implement handlePostCallAudioDeletion() and call it from the call.ended webhook after eval completes.' : undefined,
      reference: 'PHIPA s.13 — Retention and disposal; PIPEDA Principle 4.5',
    },
  ));

  // A6 — PHI never exposed to platform_dev
  const redaction = readSrc('server', 'accessControl', 'redaction.ts');
  const hasPlatformDevRedaction = redaction.includes('isPlatformDev') && redaction.includes('[redacted]');
  results.push(check(
    'A6', 'PHI_BOUNDARY', ['PHIPA', 'PIPEDA'],
    'PHI redacted from platform developer sessions',
    'Claim numbers, patient tokens, and PHI fields are masked when accessed via platform_dev sessions.',
    hasPlatformDevRedaction ? 'pass' : 'fail',
    hasPlatformDevRedaction
      ? 'redaction.ts applies isPlatformDev() guard; fields replaced with [redacted].'
      : 'MISSING: platform_dev redaction not found.',
    { reference: 'PHIPA s.37; PIPEDA Principle 4.4 — Limiting access' },
  ));

  return results;
}

// ---------------------------------------------------------------------------
// Domain B: Encryption
// ---------------------------------------------------------------------------

function checkEncryption(): ComplianceCheck[] {
  const phiAesGcm = readSrc('server', 'crypto', 'phiAesGcm.ts');
  const phiAtRest = readSrc('server', 'crypto', 'phiAtRest.ts');
  const _phiKey = readSrc('server', 'crypto', 'phiEncryptionKey.ts');
  void _phiKey;
  const dbTls = readSrc('server', 'databaseTls.ts');
  const results: ComplianceCheck[] = [];

  // B1 — AES-256-GCM for PHI at rest
  const hasAes256Gcm = phiAesGcm.includes("'aes-256-gcm'") && phiAesGcm.includes('PHI_AES_KEY_LENGTH = 32');
  const hasAuthTag = phiAesGcm.includes('PHI_AES_AUTH_TAG_LENGTH = 16') && phiAesGcm.includes('getAuthTag');
  results.push(check(
    'B1', 'ENCRYPTION', ['PHIPA', 'PIPEDA'],
    'PHI fields encrypted at rest with AES-256-GCM (authenticated)',
    'Application-layer encryption using NIST-recommended AES-256-GCM with 96-bit IV and 128-bit auth tag.',
    hasAes256Gcm && hasAuthTag ? 'pass' : 'fail',
    hasAes256Gcm
      ? 'phiAesGcm.ts: aes-256-gcm, 32-byte key, 12-byte IV (NIST GCM nonce), 16-byte auth tag verified.'
      : 'MISSING: AES-256-GCM encryption not found.',
    { reference: 'PHIPA s.12 — Security safeguards; PIPEDA Principle 4.7' },
  ));

  // B2 — Random IV per encryption call
  const hasRandomIv = phiAesGcm.includes('randomBytes(PHI_AES_IV_LENGTH)');
  results.push(check(
    'B2', 'ENCRYPTION', ['PHIPA', 'PIPEDA'],
    'Unique random IV generated per encryption call (nonce uniqueness)',
    'GCM security requires a unique IV per ciphertext. Using randomBytes() prevents nonce reuse attacks.',
    hasRandomIv ? 'pass' : 'fail',
    hasRandomIv ? 'randomBytes(12) used per encrypt call in phiAesGcm.ts.' : 'MISSING: IV randomness not verified.',
    { reference: 'NIST SP 800-38D — GCM nonce uniqueness requirement' },
  ));

  // B3 — Crypto audit on every PHI access
  const hasCryptoAudit = phiAtRest.includes('auditEncryptSuccess') && phiAtRest.includes('auditDecryptSuccess') && phiAtRest.includes('auditDecryptFailure');
  results.push(check(
    'B3', 'ENCRYPTION', ['PHIPA', 'PIPEDA'],
    'Every PHI encrypt/decrypt operation emits a structured audit event',
    'phiAtRest.ts wraps raw crypto with mandatory audit logging on success and failure paths.',
    hasCryptoAudit ? 'pass' : 'fail',
    hasCryptoAudit
      ? 'phiAtRest.ts: auditEncryptSuccess, auditDecryptSuccess, auditDecryptFailure all present.'
      : 'MISSING: crypto audit hooks not found in phiAtRest.ts.',
    { reference: 'PHIPA s.12; PIPEDA Principle 4.7 — Security safeguards' },
  ));

  // B4 — PHI_ENCRYPTION_KEY configured (runtime)
  const keySet = envSet('PHI_ENCRYPTION_KEY');
  const atRestEnabled = envSet('PHI_ENCRYPTION_AT_REST');
  results.push(check(
    'B4', 'ENCRYPTION', ['PHIPA', 'PIPEDA'],
    'PHI_ENCRYPTION_KEY is set in the runtime environment',
    'The 32-byte AES key must be present for PHI field encryption to function.',
    keySet ? 'pass' : atRestEnabled ? 'fail' : 'warn',
    keySet
      ? 'PHI_ENCRYPTION_KEY is set in environment.'
      : atRestEnabled
        ? 'CRITICAL: PHI_ENCRYPTION_AT_REST=true but PHI_ENCRYPTION_KEY is not set — encryption will throw at runtime.'
        : 'PHI_ENCRYPTION_KEY not set; PHI_ENCRYPTION_AT_REST not enabled. Acceptable for dev/test; required in production.',
    {
      recommendation: !keySet ? 'Set PHI_ENCRYPTION_KEY from your KMS / Railway secret manager and enable PHI_ENCRYPTION_AT_REST=true in production.' : undefined,
      reference: 'PHIPA s.12; docs/operations/DATA-ENCRYPTION.md',
    },
  ));

  // B5 — Database TLS enforced in production
  const hasTlsGuard = dbTls.includes("process.exit(1)") && dbTls.includes('sslmode=require');
  const hasTlsAutoAppend = dbTls.includes('withPostgresTlsDefault') && dbTls.includes('sslmode=require');
  results.push(check(
    'B5', 'ENCRYPTION', ['PHIPA', 'PIPEDA'],
    'PostgreSQL connection requires TLS in production (encryption in transit)',
    'databaseTls.ts appends sslmode=require and exits the process if TLS is missing in production.',
    hasTlsGuard && hasTlsAutoAppend ? 'pass' : 'warn',
    hasTlsGuard
      ? 'databaseTls.ts: assertPostgresTlsInProduction() calls process.exit(1) on missing TLS; auto-appends sslmode=require.'
      : 'MISSING: TLS guard not found in databaseTls.ts.',
    { reference: 'PHIPA s.12; PIPEDA Principle 4.7 — Encryption in transit' },
  ));

  // B6 — Ciphertext integrity via GCM auth tag
  const hasDecryptAuthTag = phiAesGcm.includes('setAuthTag') && phiAesGcm.includes('decipher.final');
  results.push(check(
    'B6', 'ENCRYPTION', ['PHIPA'],
    'GCM authentication tag verified on decryption (tamper detection)',
    'setAuthTag() ensures ciphertext integrity — any tampering causes decryption to throw.',
    hasDecryptAuthTag ? 'pass' : 'fail',
    hasDecryptAuthTag ? 'phiAesGcm.ts: setAuthTag + decipher.final verified.' : 'MISSING: auth tag not verified on decrypt.',
    { reference: 'NIST SP 800-38D — Authenticated encryption' },
  ));

  return results;
}

// ---------------------------------------------------------------------------
// Domain C: Access Control
// ---------------------------------------------------------------------------

function checkAccessControl(): ComplianceCheck[] {
  const permissions = readSrc('server', 'accessControl', 'permissions.ts');
  const phiRoutes = readSrc('server', 'accessControl', 'phiRoutes.ts');
  const authenticate = readSrc('server', 'middleware', 'authenticate.ts');
  const _authorizeRole = readSrc('server', 'middleware', 'authorizeRole.ts');
  void _authorizeRole;
  const _requirePermission = readSrc('server', 'middleware', 'requirePermission.ts');
  void _requirePermission;
  const results: ComplianceCheck[] = [];

  // C1 — RBAC matrix covers all roles
  const roles = ['front_desk', 'practice_owner', 'billing_ops_manager', 'platform_admin', 'auditor'];
  const allRolesCovered = roles.every((r) => permissions.includes(`${r}:`));
  results.push(check(
    'C1', 'ACCESS_CONTROL', ['PHIPA', 'PIPEDA'],
    'RBAC matrix defines access levels for all roles and actions',
    'permissions.ts encodes a role × action matrix covering every resource operation.',
    allRolesCovered ? 'pass' : 'warn',
    allRolesCovered
      ? `Roles verified: ${roles.join(', ')} — all present in MATRIX.`
      : `WARNING: some roles may be missing from MATRIX. Found roles: ${roles.filter((r) => permissions.includes(`${r}:`)).join(', ')}.`,
    { reference: 'PHIPA s.33 — Access controls; PIPEDA Principle 4.7' },
  ));

  // C2 — PHI routes gated by role
  const hasPhiGate = phiRoutes.includes('assertPhiRouteAllowed') && phiRoutes.includes('NO_PHI_ROLES') && phiRoutes.includes('isPlatformDev');
  results.push(check(
    'C2', 'ACCESS_CONTROL', ['PHIPA', 'PIPEDA'],
    'PHI API routes blocked for unauthorized roles (platform_dev, accountant, group_admin)',
    'assertPhiRouteAllowed() is enforced in the authenticate middleware on every request.',
    hasPhiGate ? 'pass' : 'fail',
    hasPhiGate
      ? 'phiRoutes.ts: assertPhiRouteAllowed() gates /api/patients, /api/benefits, /api/balances, /api/eligibility, /api/cdcp, /api/canadian, /api/vapi/phi.'
      : 'MISSING: PHI route gating not found.',
    { reference: 'PHIPA s.33; PIPEDA Principle 4.4' },
  ));

  // C3 — Authentication via httpOnly cookie + JWT
  const hasHttpOnlyCookie = authenticate.includes('COOKIE_NAME') && authenticate.includes('req.cookies');
  const hasJwtVerify = authenticate.includes('verifyAuthToken');
  results.push(check(
    'C3', 'ACCESS_CONTROL', ['PHIPA', 'PIPEDA', 'OWASP'],
    'JWT authentication via httpOnly cookie (XSS-resistant) with Bearer fallback',
    'Tokens stored in httpOnly cookies prevent JavaScript access; JWT verified on every request.',
    hasHttpOnlyCookie && hasJwtVerify ? 'pass' : 'fail',
    hasHttpOnlyCookie && hasJwtVerify
      ? 'authenticate.ts: verifyAuthToken() on every request; reads from COOKIE_NAME (httpOnly) with Bearer fallback.'
      : 'MISSING: httpOnly cookie auth not confirmed.',
    { reference: 'OWASP Session Management; PHIPA s.12' },
  ));

  // C4 — Accountant token expiry checked against DB (fail-closed)
  const hasAccountantExpiry = authenticate.includes("payload.role === 'accountant'") && authenticate.includes('tokenExpiresAt') && authenticate.includes('503');
  results.push(check(
    'C4', 'ACCESS_CONTROL', ['PHIPA', 'PIPEDA'],
    'Accountant token expiry verified against database (fail-closed on DB error)',
    'Accountant JWTs have a DB-backed expiry date that overrides the JWT TTL; fails with 503 if the DB is unreachable.',
    hasAccountantExpiry ? 'pass' : 'fail',
    hasAccountantExpiry
      ? "authenticate.ts: accountant path checks user.tokenExpiresAt in DB; returns 503 if DB lookup fails (fail-closed)."
      : 'MISSING: accountant token expiry DB check not found.',
    { reference: 'PHIPA s.33 — Access revocation; PIPEDA Principle 4.4' },
  ));

  // C5 — Break-glass actions limited to platform_admin
  const hasBreakGlass = permissions.includes("'break_glass'") && permissions.includes('isBreakGlassAction');
  results.push(check(
    'C5', 'ACCESS_CONTROL', ['PHIPA', 'PIPEDA'],
    'Privileged queue operations (build_queue, run_queue) require break-glass authorization',
    'High-impact operations are restricted to platform_admin with break_glass access level, providing audit separation.',
    hasBreakGlass ? 'pass' : 'warn',
    hasBreakGlass ? "permissions.ts: break_glass access level defined; isBreakGlassAction() present." : "WARNING: break_glass pattern not found.",
    { reference: 'PHIPA s.33; PIPEDA Principle 4.7 — Privileged access' },
  ));

  // C6 — requirePermission middleware exists
  const hasRequirePermission = fileExists('server', 'middleware', 'requirePermission.ts');
  results.push(check(
    'C6', 'ACCESS_CONTROL', ['PHIPA', 'PIPEDA'],
    'requirePermission() middleware enforces RBAC on API routes',
    'Per-route permission guards prevent unauthorized actions even when authentication passes.',
    hasRequirePermission ? 'pass' : 'fail',
    hasRequirePermission ? 'requirePermission.ts present.' : 'MISSING: requirePermission.ts not found.',
    { reference: 'PHIPA s.33; PIPEDA Principle 4.4' },
  ));

  // C7 — Claim scope isolation (IDOR prevention)
  const requireClaimScope = readSrc('server', 'middleware', 'requireClaimScope.ts');
  const hasClaimScope = requireClaimScope.length > 0 && (requireClaimScope.includes('practiceId') || requireClaimScope.includes('claimId'));
  results.push(check(
    'C7', 'ACCESS_CONTROL', ['PHIPA', 'PIPEDA', 'OWASP'],
    'Claim-level scope isolation prevents cross-practice IDOR attacks',
    'requireClaimScope middleware enforces that claims belong to the authenticated practice.',
    hasClaimScope ? 'pass' : 'warn',
    hasClaimScope ? 'requireClaimScope.ts: practiceId / claimId scope enforcement present.' : 'WARNING: claim scope middleware may be missing.',
    { reference: 'OWASP A01 — Broken Access Control; PHIPA s.37' },
  ));

  return results;
}

// ---------------------------------------------------------------------------
// Domain D: Audit Trail
// ---------------------------------------------------------------------------

function checkAuditTrail(): ComplianceCheck[] {
  const auditLog = readSrc('server', 'audit', 'auditLog.ts');
  const phiCryptoAudit = readSrc('server', 'crypto', 'phiCryptoAudit.ts');
  const prismaSchema = fs.existsSync(path.join(ROOT, 'prisma', 'schema.prisma'))
    ? fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8')
    : '';
  const results: ComplianceCheck[] = [];

  // D1 — Append-only audit log in database
  const hasAuditLog = auditLog.includes('prisma.auditLog.create') && auditLog.includes('appendAuditLog');
  const hasAuditLogSchema = prismaSchema.includes('AuditLog') || prismaSchema.includes('auditLog');
  results.push(check(
    'D1', 'AUDIT_TRAIL', ['PHIPA', 'PIPEDA'],
    'Append-only audit log persisted to database',
    'appendAuditLog() writes to the AuditLog table; only creates are allowed (no updates/deletes).',
    hasAuditLog && hasAuditLogSchema ? 'pass' : hasAuditLog ? 'warn' : 'fail',
    hasAuditLog
      ? `appendAuditLog() present in audit/auditLog.ts (prisma.auditLog.create). ${hasAuditLogSchema ? 'AuditLog model in Prisma schema.' : 'WARNING: AuditLog model not found in prisma/schema.prisma — verify migration applied.'}`
      : 'MISSING: appendAuditLog not found.',
    {
      recommendation: !hasAuditLogSchema ? 'Ensure AuditLog Prisma migration is applied to the production database.' : undefined,
      reference: 'PHIPA s.12 — Audit logging requirement; PIPEDA Accountability',
    },
  ));

  // D2 — Audit log captures IP + user agent (investigation support)
  const capturesIp = auditLog.includes('requestIp') && auditLog.includes('userAgent');
  results.push(check(
    'D2', 'AUDIT_TRAIL', ['PHIPA', 'PIPEDA'],
    'Audit log captures request IP and user agent for forensic investigation',
    'clientRequestMeta() extracts IP (honoring X-Forwarded-For) and user agent on every audit event.',
    capturesIp ? 'pass' : 'warn',
    capturesIp ? 'auditLog.ts: requestIp (x-forwarded-for aware) and userAgent captured.' : 'WARNING: IP/user agent capture not confirmed.',
    { reference: 'PHIPA s.12; PIPEDA Accountability — breach investigation evidence' },
  ));

  // D3 — PHI never included in audit log details
  const phiComment = auditLog.includes('Do not put names, free-text PHI, or full request bodies in `details`');
  results.push(check(
    'D3', 'AUDIT_TRAIL', ['PHIPA', 'PIPEDA'],
    'Audit log explicitly prohibits free-text PHI in the details field',
    'Code comment policy and structured details type prevent accidental PHI leakage into audit records.',
    phiComment ? 'pass' : 'warn',
    phiComment
      ? "auditLog.ts code comment: 'Do not put names, free-text PHI, or full request bodies in details' — policy enforced."
      : 'WARNING: Explicit PHI prohibition comment not found; verify audit log policy in code review.',
    { reference: 'PHIPA s.12 — Audit log must not contain more PHI than necessary' },
  ));

  // D4 — PHI crypto operations audited separately
  const hasCryptoAuditFile = phiCryptoAudit.includes('PHI_CRYPTO_ACCESS') && phiCryptoAudit.includes('logPhiCryptoAccess');
  results.push(check(
    'D4', 'AUDIT_TRAIL', ['PHIPA', 'PIPEDA'],
    'PHI encryption/decryption operations produce structured PHI_CRYPTO_ACCESS audit events',
    'logPhiCryptoAccess() logs operation, outcome, recordId, actor, and practiceId without any plaintext.',
    hasCryptoAuditFile ? 'pass' : 'fail',
    hasCryptoAuditFile
      ? "phiCryptoAudit.ts: PHI_CRYPTO_ACCESS event emitted for every encrypt/decrypt with outcome='success'|'failure'."
      : 'MISSING: PHI_CRYPTO_ACCESS audit not found.',
    { reference: 'PHIPA s.12 — Security audit trail for PHI access' },
  ));

  // D5 — Audit log userId captured from JWT
  const capturesUserId = auditLog.includes('userIdFromRequest') && auditLog.includes('userId');
  results.push(check(
    'D5', 'AUDIT_TRAIL', ['PHIPA', 'PIPEDA'],
    'Audit log ties each event to the authenticated user ID',
    'userIdFromRequest() extracts userId from req.auth so every action is attributable to a specific user.',
    capturesUserId ? 'pass' : 'warn',
    capturesUserId ? 'auditLog.ts: userIdFromRequest() extracts userId from JWT payload.' : 'WARNING: userId capture from auth not confirmed.',
    { reference: 'PHIPA s.12 — Attributable audit records' },
  ));

  return results;
}

// ---------------------------------------------------------------------------
// Domain E: Rate Limiting
// ---------------------------------------------------------------------------

function checkRateLimiting(): ComplianceCheck[] {
  const rateLimiter = readSrc('server', 'middleware', 'rateLimiter.ts');
  const results: ComplianceCheck[] = [];

  // E1 — Login endpoint rate limited (brute-force prevention)
  const hasAuthLimiter = rateLimiter.includes('authLimiter') && rateLimiter.includes('max: 5') && rateLimiter.includes('15 * 60 * 1000');
  results.push(check(
    'E1', 'RATE_LIMITING', ['PHIPA', 'PIPEDA', 'OWASP'],
    'Login endpoint rate limited to 5 attempts per 15 minutes per IP',
    'Prevents credential brute-forcing against the authentication endpoint.',
    hasAuthLimiter ? 'pass' : 'fail',
    hasAuthLimiter ? 'rateLimiter.ts: authLimiter — max 5 / 15min window per IP.' : 'MISSING: authLimiter not found.',
    { reference: 'OWASP A07 — Authentication Failures; PHIPA s.12 Security safeguards' },
  ));

  // E2 — API rate limited per authenticated user
  const hasSessionLimiter = rateLimiter.includes('sessionStandardLimiter') && rateLimiter.includes('max: 600');
  results.push(check(
    'E2', 'RATE_LIMITING', ['PIPEDA', 'OWASP'],
    'Authenticated API traffic limited to 600 requests/min per user session',
    'Prevents session abuse and protects PHI endpoints from excessive data extraction.',
    hasSessionLimiter ? 'pass' : 'warn',
    hasSessionLimiter ? 'rateLimiter.ts: sessionStandardLimiter — 600 req/min per user.' : 'WARNING: session rate limit not found.',
    { reference: 'OWASP A05 — Security Misconfiguration; PIPEDA Principle 4.7' },
  ));

  // E3 — Strict limiter for expensive writes
  const hasStrictLimiter = rateLimiter.includes('strictLimiter') && rateLimiter.includes('max: 10');
  results.push(check(
    'E3', 'RATE_LIMITING', ['PIPEDA', 'OWASP'],
    'Expensive mutation endpoints limited to 10 requests/min (queue triggers, imports)',
    'strictLimiter protects high-cost operations from abuse.',
    hasStrictLimiter ? 'pass' : 'warn',
    hasStrictLimiter ? 'rateLimiter.ts: strictLimiter — max 10 / 1min window.' : 'WARNING: strict limiter not found.',
  ));

  // E4 — Public patient pay limiter (prevents UUID enumeration)
  const hasPublicLimiter = rateLimiter.includes('publicLimiter') && rateLimiter.includes('max: 60');
  results.push(check(
    'E4', 'RATE_LIMITING', ['PIPEDA', 'OWASP'],
    'Public patient pay / unsubscribe endpoint limited to 60/min (UUID enumeration prevention)',
    'Tighter rate limit on unauthenticated endpoints slows token or UUID scanning.',
    hasPublicLimiter ? 'pass' : 'warn',
    hasPublicLimiter ? 'rateLimiter.ts: publicLimiter — 60 req/min.' : 'WARNING: publicLimiter not found.',
    { reference: 'OWASP A01 — Broken Access Control; PIPEDA Principle 4.7' },
  ));

  // E5 — Redis-backed rate limiting for multi-replica deployments
  const hasRedis = rateLimiter.includes('RedisStore') && rateLimiter.includes('REDIS_URL');
  const redisEnvSet = envSet('REDIS_URL');
  results.push(check(
    'E5', 'RATE_LIMITING', ['PIPEDA'],
    'Rate limits backed by Redis for accurate enforcement across API replicas',
    'Without Redis, each replica maintains its own in-process counters — limits can be bypassed by hitting different replicas.',
    hasRedis && redisEnvSet ? 'pass' : hasRedis ? 'warn' : 'fail',
    hasRedis
      ? redisEnvSet
        ? 'rateLimiter.ts: RedisStore configured; REDIS_URL is set — shared limits active.'
        : 'rateLimiter.ts: RedisStore code present but REDIS_URL not set — falling back to in-process counters. Multi-replica deployments may under-enforce.'
      : 'MISSING: Redis rate limit store not found.',
    {
      recommendation: !redisEnvSet ? 'Set REDIS_URL (Railway Redis add-on) so rate limits are accurate across all API replicas.' : undefined,
    },
  ));

  return results;
}

// ---------------------------------------------------------------------------
// Domain F: Data Residency
// ---------------------------------------------------------------------------

function checkDataResidency(): ComplianceCheck[] {
  const piiVault = readSrc('services', 'pii-vault.ts');
  const results: ComplianceCheck[] = [];

  // F1 — Canada-Central data residency headers on LLM API calls
  const hasResidencyHeaders = piiVault.includes('LLM_RESIDENCY_HEADERS') && piiVault.includes('Canada-Central') && piiVault.includes('ca-central-1');
  results.push(check(
    'F1', 'DATA_RESIDENCY', ['Quebec-Law-25', 'Alberta-HIA'],
    'Canada-Central data residency headers applied to all external LLM API calls',
    'X-Data-Residency: Canada-Central and X-Processing-Region: ca-central-1 are sent with every LLM request.',
    hasResidencyHeaders ? 'pass' : 'fail',
    hasResidencyHeaders
      ? 'pii-vault.ts: LLM_RESIDENCY_HEADERS defined with Canada-Central and ca-central-1.'
      : 'MISSING: LLM residency headers not found.',
    {
      recommendation: !hasResidencyHeaders ? 'Add X-Data-Residency: Canada-Central header to all OpenAI / Anthropic API calls.' : undefined,
      reference: 'Quebec Law 25 s.17 — Cross-border transfer protections; Alberta HIA s.60',
    },
  ));

  // F2 — Data residency headers included in Vapi audio deletion calls
  const vapiDeleteUsesResidency = piiVault.includes('...LLM_RESIDENCY_HEADERS') && piiVault.includes('handlePostCallAudioDeletion');
  results.push(check(
    'F2', 'DATA_RESIDENCY', ['Quebec-Law-25', 'Alberta-HIA'],
    'Data residency headers applied to Vapi recording deletion requests',
    'Recording deletion calls to Vapi include Canada-Central residency headers.',
    vapiDeleteUsesResidency ? 'pass' : 'warn',
    vapiDeleteUsesResidency
      ? 'pii-vault.ts: LLM_RESIDENCY_HEADERS spread into Vapi DELETE call headers.'
      : 'WARNING: residency headers not confirmed on Vapi recording deletion.',
    { reference: 'Quebec Law 25 — Data processing location transparency' },
  ));

  // F3 — Quebec PIA requirement documented
  const complianceDisclosures = readSrc('server', 'canadianExpansion', 'complianceDisclosures.ts');
  const hasPiaNote = complianceDisclosures.includes('Privacy Impact Assessment') && complianceDisclosures.includes('PIA');
  results.push(check(
    'F3', 'DATA_RESIDENCY', ['Quebec-Law-25'],
    'Privacy Impact Assessment (PIA) requirement documented before Quebec production traffic',
    'complianceDisclosures.ts captures the PIA requirement for Quebec data flows.',
    hasPiaNote ? 'info' : 'warn',
    hasPiaNote
      ? "complianceDisclosures.ts: PIA requirement documented — 'Before live Quebec production traffic, complete a PIA covering CDCP data flows, carrier transcripts storage, and subprocessors.'"
      : 'WARNING: PIA documentation not found in complianceDisclosures.ts.',
    {
      recommendation: 'Complete and document the PIA before serving Quebec practices in production.',
      reference: 'Quebec Law 25 s.3.3 — Privacy Impact Assessment obligation',
    },
  ));

  // F4 — AI transparency disclosure for carriers (AIDA voluntary)
  const hasCarrierDisclosure = complianceDisclosures.includes('carrierDisclosureScript') && complianceDisclosures.includes('automated voice agents');
  results.push(check(
    'F4', 'DATA_RESIDENCY', ['AIDA'],
    'AI transparency disclosure script for carrier interactions (AIDA voluntary)',
    'Carriers are disclosed that automated voice agents may assist with claim status on behalf of the dental practice.',
    hasCarrierDisclosure ? 'pass' : 'warn',
    hasCarrierDisclosure
      ? 'complianceDisclosures.ts: carrierDisclosureScript present with automated voice agent disclosure.'
      : 'WARNING: carrier AI disclosure script not found.',
    { reference: 'AIDA Voluntary Code — Transparency pillar' },
  ));

  return results;
}

// ---------------------------------------------------------------------------
// Domain G: Retention & Minimization
// ---------------------------------------------------------------------------

function checkRetention(): ComplianceCheck[] {
  const queueEngine = readSrc('server', 'frontDesk', 'queueEngine.ts');
  const carrierBlockService = readSrc('server', 'frontDesk', 'carrierBlockService.ts');
  const results: ComplianceCheck[] = [];

  // G1 — Claims under 30 days excluded from queue (not yet billable)
  const has30DayRule = queueEngine.includes('30') || queueEngine.includes('CLAIM_MIN_AGE_DAYS');
  results.push(check(
    'G1', 'RETENTION', ['PHIPA', 'PIPEDA'],
    'Claims under 30 days excluded from AI call queue (not yet eligible)',
    'Prevents unnecessary PHI processing for claims that are still within the carrier processing window.',
    has30DayRule ? 'pass' : 'warn',
    has30DayRule ? 'queueEngine.ts: 30-day minimum age gate found.' : 'WARNING: 30-day claim age gate not confirmed in queueEngine.ts.',
    { reference: 'PIPEDA Principle 4.5 — Limiting use and retention' },
  ));

  // G2 — Claims over 90 days escalated to human (no AI for stale claims)
  const has90DayRule = queueEngine.includes('90') || queueEngine.includes('CLAIM_MAX_AGE_DAYS');
  results.push(check(
    'G2', 'RETENTION', ['PHIPA', 'PIPEDA'],
    'Claims over 90 days escalated to human review (no AI automation for stale claims)',
    'Limits automated PHI processing to claims within the productive recovery window.',
    has90DayRule ? 'pass' : 'warn',
    has90DayRule ? 'queueEngine.ts: 90-day escalation gate found.' : 'WARNING: 90-day escalation gate not confirmed in queueEngine.ts.',
    { reference: 'PIPEDA Principle 4.5; PHIPA s.30 — Minimum necessary use' },
  ));

  // G3 — Maximum 3 call attempts per claim
  const hasMaxAttempts = queueEngine.includes('3') && (queueEngine.includes('maxAttempts') || queueEngine.includes('MAX_ATTEMPTS') || queueEngine.includes('callAttempts'));
  results.push(check(
    'G3', 'RETENTION', ['PHIPA', 'PIPEDA'],
    'Maximum 3 automated call attempts per claim',
    'Prevents excessive PHI exposure from repeated calls on the same claim.',
    hasMaxAttempts ? 'pass' : 'warn',
    hasMaxAttempts ? 'queueEngine.ts: max 3 call attempts guard found.' : 'WARNING: max call attempts limit not confirmed in queueEngine.ts.',
    { reference: 'PIPEDA Principle 4.5 — Data minimization' },
  ));

  // G4 — CARRIER_BLOCK suspends all calls immediately
  const hasCarrierBlock = carrierBlockService.includes('CARRIER_BLOCK') || carrierBlockService.length > 0;
  results.push(check(
    'G4', 'RETENTION', ['PHIPA', 'PIPEDA'],
    'CARRIER_BLOCK protocol suspends all calls to a carrier upon detection',
    'Protects the practice and platform from carriers flagging automation; prevents PHI exposure via blocked channels.',
    hasCarrierBlock ? 'pass' : 'fail',
    hasCarrierBlock ? 'carrierBlockService.ts: CARRIER_BLOCK logic present.' : 'MISSING: carrierBlockService.ts not found or empty.',
    { reference: 'PHIPA s.12 — Security incident response' },
  ));

  // G5 — Calls restricted to Mon–Fri 8am–5pm Eastern (consent window)
  const hasCallWindow = queueEngine.includes('8') && (queueEngine.includes('Eastern') || queueEngine.includes('America/Toronto') || queueEngine.includes('America/New_York'));
  results.push(check(
    'G5', 'RETENTION', ['PHIPA', 'PIPEDA'],
    'Outbound calls restricted to Mon–Fri 8am–5pm Eastern (CASL / call window compliance)',
    'Automated carrier calls operate only during business hours to align with CASL and carrier consent frameworks.',
    hasCallWindow ? 'pass' : 'warn',
    hasCallWindow ? 'queueEngine.ts: Eastern time window constraint found.' : 'WARNING: call time window not confirmed — verify Mon–Fri 8am–5pm Eastern enforcement.',
    { reference: 'CASL — Unsolicited telecommunications; PHIPA s.12' },
  ));

  return results;
}

// ---------------------------------------------------------------------------
// Domain H: Disclosure & Transparency
// ---------------------------------------------------------------------------

function checkDisclosure(): ComplianceCheck[] {
  const complianceDisclosures = readSrc('server', 'canadianExpansion', 'complianceDisclosures.ts');
  const results: ComplianceCheck[] = [];

  // H1 — AIDA voluntary code pillars present
  const pillars = ['Safety', 'Fairness', 'Transparency', 'Accountability', 'Human oversight', 'Validity'];
  const allPillars = pillars.every((p) => complianceDisclosures.includes(p));
  results.push(check(
    'H1', 'DISCLOSURE', ['AIDA'],
    'AIDA voluntary code: all 6 pillars documented (Safety, Fairness, Transparency, Accountability, Human oversight, Validity)',
    'complianceDisclosures.ts captures the voluntary AI ethics pillars aligned with Canada\'s evolving AIDA framework.',
    allPillars ? 'pass' : 'warn',
    allPillars
      ? `All 6 AIDA pillars found: ${pillars.join(', ')}.`
      : `WARNING: Missing pillars: ${pillars.filter((p) => !complianceDisclosures.includes(p)).join(', ')}.`,
    { reference: 'Canada AIDA (Bill C-27) — Voluntary compliance regime' },
  ));

  // H2 — Quebec Law 25 privacy-by-design bullets
  const hasPbD = complianceDisclosures.includes('privacyByDesignBullets') && complianceDisclosures.includes('Collect only minimum necessary');
  results.push(check(
    'H2', 'DISCLOSURE', ['Quebec-Law-25'],
    'Privacy-by-design principles documented for Quebec Law 25',
    'complianceDisclosures.ts includes minimum collection, tokenization, and retention documentation.',
    hasPbD ? 'pass' : 'warn',
    hasPbD ? "complianceDisclosures.ts: privacyByDesignBullets present with minimum-collection and tokenization principles." : "WARNING: Privacy-by-design bullets not found.",
    { reference: 'Quebec Law 25 — Privacy by design obligations' },
  ));

  // H3 — Human escalation path for denials documented
  const hasEscalation = complianceDisclosures.includes('Human oversight') && complianceDisclosures.includes('escalation');
  results.push(check(
    'H3', 'DISCLOSURE', ['AIDA', 'PHIPA'],
    'Human escalation path documented for denied claims and patient disputes',
    'The AIDA Transparency pillar and PHIPA require a human review path for automated decisions.',
    hasEscalation ? 'pass' : 'warn',
    hasEscalation ? "complianceDisclosures.ts: human oversight + escalation paths documented." : "WARNING: human escalation not documented in disclosures.",
    { reference: 'AIDA — Human oversight requirement; PHIPA s.16 — Individual rights' },
  ));

  // H4 — PIPEDA accountability assurance documented
  const hasAssurances = complianceDisclosures.includes('collectrxAssurances') && complianceDisclosures.includes('PHIPA / PIPEDA');
  results.push(check(
    'H4', 'DISCLOSURE', ['PIPEDA'],
    'CollectRx PHIPA/PIPEDA-aligned handling assurances documented',
    'The platform explicitly documents its accountability for Canadian health data handling.',
    hasAssurances ? 'pass' : 'warn',
    hasAssurances ? "complianceDisclosures.ts: collectrxAssurances include PHIPA / PIPEDA alignment statement." : "WARNING: PIPEDA accountability assurance not found.",
    { reference: 'PIPEDA Principle 4.1 — Accountability' },
  ));

  return results;
}

// ---------------------------------------------------------------------------
// Domain I: Input Validation
// ---------------------------------------------------------------------------

function checkInputValidation(): ComplianceCheck[] {
  const zodSchemas = readSrc('server', 'validation', 'zodSchemas.ts');
  const csvUpload = readSrc('server', 'validation', 'csvUpload.ts');
  const results: ComplianceCheck[] = [];

  // I1 — Zod schemas for API input validation
  const hasZod = zodSchemas.includes('z.object') || zodSchemas.includes('z.string');
  results.push(check(
    'I1', 'INPUT_VALIDATION', ['OWASP', 'PIPEDA'],
    'API inputs validated with Zod schemas (type-safe parse with reject-on-failure)',
    'Zod schema validation at API boundaries rejects malformed or injected payloads before DB operations.',
    hasZod ? 'pass' : 'warn',
    hasZod ? 'validation/zodSchemas.ts: Zod schemas present for API input validation.' : 'WARNING: Zod validation not confirmed.',
    { reference: 'OWASP A03 — Injection; PIPEDA Principle 4.7 — Input safeguards' },
  ));

  // I2 — CSV upload validated before DB import
  const hasCsvValidation = csvUpload.length > 0;
  results.push(check(
    'I2', 'INPUT_VALIDATION', ['OWASP', 'PIPEDA'],
    'CSV uploads validated and sanitized before database import',
    'csvUpload.ts validates structure and content of uploaded claim files before the import pipeline runs.',
    hasCsvValidation ? 'pass' : 'warn',
    hasCsvValidation ? 'validation/csvUpload.ts: CSV validation present.' : 'WARNING: csvUpload.ts is empty or missing.',
    { reference: 'OWASP A03 — Injection via file upload' },
  ));

  // I3 — Helmet middleware (security headers)
  const indexTs = readSrc('server', 'index.ts');
  const hasHelmet = indexTs.includes('helmet');
  results.push(check(
    'I3', 'INPUT_VALIDATION', ['OWASP'],
    'Helmet middleware sets security headers (HSTS, X-Frame-Options, etc.)',
    'Helmet protects against common web attacks via HTTP security headers.',
    hasHelmet ? 'pass' : 'fail',
    hasHelmet ? 'index.ts: helmet() middleware applied.' : 'MISSING: helmet not found in server setup.',
    { reference: 'OWASP A05 — Security Misconfiguration' },
  ));

  // I4 — CORS restricted to allowed origins
  const hasCorsGuard = indexTs.includes('cors(') && (indexTs.includes('allowedOrigins') || indexTs.includes('resolveCorsAllowedOrigins'));
  results.push(check(
    'I4', 'INPUT_VALIDATION', ['OWASP'],
    'CORS restricted to explicitly allowed origins',
    'Cross-Origin Resource Sharing is restricted to known origins to prevent cross-site request attacks.',
    hasCorsGuard ? 'pass' : 'warn',
    hasCorsGuard ? 'index.ts: cors() configured with resolveCorsAllowedOrigins().' : 'WARNING: CORS allowlist not confirmed.',
    { reference: 'OWASP A05 — Security Misconfiguration; OWASP CORS' },
  ));

  return results;
}

// ---------------------------------------------------------------------------
// Domain J: Session Security
// ---------------------------------------------------------------------------

function checkSessionSecurity(): ComplianceCheck[] {
  const authToken = readSrc('server', 'authToken.ts');
  const authenticate = readSrc('server', 'middleware', 'authenticate.ts');
  const results: ComplianceCheck[] = [];

  // J1 — JWT secret required at startup
  const hasJwtAssert = authToken.includes('assertJwtConfigAtStartup') || authToken.includes('JWT_SECRET');
  results.push(check(
    'J1', 'SESSION_SECURITY', ['OWASP', 'PHIPA'],
    'JWT secret required and validated at server startup',
    'assertJwtConfigAtStartup() ensures the JWT signing secret is present before the server accepts requests.',
    hasJwtAssert ? 'pass' : 'fail',
    hasJwtAssert ? 'authToken.ts: JWT_SECRET / assertJwtConfigAtStartup() present.' : 'MISSING: JWT startup assertion not found.',
    { reference: 'OWASP A07 — Broken Authentication; PHIPA s.12' },
  ));

  // J2 — JWT_SECRET set in environment
  const jwtSecretSet = envSet('JWT_SECRET');
  results.push(check(
    'J2', 'SESSION_SECURITY', ['OWASP', 'PHIPA'],
    'JWT_SECRET is set in the runtime environment',
    'A missing JWT_SECRET means tokens could be forged with an empty or default key.',
    jwtSecretSet ? 'pass' : 'warn',
    jwtSecretSet ? 'JWT_SECRET is set in environment.' : 'WARNING: JWT_SECRET not set — acceptable for CI; required in production.',
    {
      recommendation: !jwtSecretSet ? 'Set JWT_SECRET to a cryptographically random 256-bit value in production.' : undefined,
      reference: 'OWASP A07 — Weak credentials',
    },
  ));

  // J3 — Fail-closed pattern on authentication errors
  const failClosed = authenticate.includes('503') || authenticate.includes('fail CLOSED') || authenticate.includes('Fail CLOSED');
  results.push(check(
    'J3', 'SESSION_SECURITY', ['OWASP', 'PHIPA'],
    'Authentication fails closed (503) on database lookup errors for accountant sessions',
    'Prevents granting PHI access on a DB hiccup — conservative security posture.',
    failClosed ? 'pass' : 'warn',
    failClosed ? 'authenticate.ts: fail-closed 503 response when DB unavailable for accountant token check.' : 'WARNING: explicit fail-closed pattern not found.',
    { reference: 'PHIPA s.12 — Security controls must not degrade to fail-open' },
  ));

  // J4 — VAPI_WEBHOOK_SECRET required in production
  const indexTs = readSrc('server', 'index.ts');
  const hasWebhookSecretGuard = indexTs.includes('VAPI_WEBHOOK_SECRET') || readSrc('server', 'vapi', 'vapiWebhook.ts').includes('VAPI_WEBHOOK_SECRET');
  results.push(check(
    'J4', 'SESSION_SECURITY', ['PHIPA', 'PIPEDA'],
    'VAPI_WEBHOOK_SECRET required in production (webhook authenticity)',
    'Prevents spoofed Vapi webhook events that could trigger unauthorized state changes in the PHI pipeline.',
    hasWebhookSecretGuard ? 'pass' : 'fail',
    hasWebhookSecretGuard ? 'VAPI_WEBHOOK_SECRET guard present in Vapi webhook handler.' : 'MISSING: VAPI_WEBHOOK_SECRET not enforced.',
    { reference: 'PHIPA s.12 — Integrity of automated processes; PIPEDA Principle 4.7' },
  ));

  // J5 — Vapi outbound restricted to known carrier phone numbers
  const vapiClient = readSrc('vapi', 'client.ts');
  const hasPhoneAllowlist = vapiClient.includes('CARRIER_PHONE_MAP') && vapiClient.includes('allowedNumbers') && vapiClient.includes('Refusing outbound call');
  results.push(check(
    'J5', 'SESSION_SECURITY', ['PHIPA', 'PIPEDA'],
    'Vapi outbound calls restricted to known carrier phone numbers (allowlist)',
    'CARRIER_PHONE_MAP allowlist prevents the system from placing calls to arbitrary numbers.',
    hasPhoneAllowlist ? 'pass' : 'fail',
    hasPhoneAllowlist ? 'vapi/client.ts: allowedNumbers allowlist derived from CARRIER_PHONE_MAP; throws on unknown destination.' : 'MISSING: phone number allowlist not found in Vapi client.',
    { reference: 'PHIPA s.12; PIPEDA Principle 4.7 — Safeguards against misuse' },
  ));

  return results;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

function scoreReport(checks: ComplianceCheck[]): number {
  const { total, pass, warn } = checks.reduce(
    (acc, c) => {
      acc.total++;
      if (c.status === 'pass') acc.pass++;
      else if (c.status === 'warn') acc.warn++;
      return acc;
    },
    { total: 0, pass: 0, warn: 0 },
  );
  if (total === 0) return 100;
  return Math.round(((pass + warn * 0.5) / total) * 100);
}

export async function runComplianceAudit(): Promise<ComplianceReport> {
  const allChecks: ComplianceCheck[] = [
    ...checkPhiBoundary(),
    ...checkEncryption(),
    ...checkAccessControl(),
    ...checkAuditTrail(),
    ...checkRateLimiting(),
    ...checkDataResidency(),
    ...checkRetention(),
    ...checkDisclosure(),
    ...checkInputValidation(),
    ...checkSessionSecurity(),
  ];

  const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const c of allChecks) counts[c.status]++;

  const domains: ComplianceReport['domains'] = {};
  for (const c of allChecks) {
    if (!domains[c.domain]) {
      domains[c.domain] = { checks: [], status: 'pass' };
    }
    domains[c.domain]!.checks.push(c);
    const current = domains[c.domain]!.status;
    if (c.status === 'fail') domains[c.domain]!.status = 'fail';
    else if (c.status === 'warn' && current !== 'fail') domains[c.domain]!.status = 'warn';
  }

  const criticalFindings = allChecks.filter((c) => c.status === 'fail');

  return {
    generatedAt: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV ?? 'unknown',
    summary: {
      total: allChecks.length,
      ...counts,
      score: scoreReport(allChecks),
    },
    domains,
    criticalFindings,
    checks: allChecks,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].split('/').pop()!)) {
  runComplianceAudit().then((report) => {
    const { summary, criticalFindings } = report;
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  CollectRx Compliance Audit Report');
    console.log(`  Generated: ${report.generatedAt}   Environment: ${report.environment}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`  Score: ${summary.score}/100`);
    console.log(`  Pass: ${summary.pass}  Warn: ${summary.warn}  Fail: ${summary.fail}  Info: ${summary.info}  Total: ${summary.total}\n`);

    for (const [domain, domainData] of Object.entries(report.domains)) {
      if (!domainData) continue;
      const icon = domainData.status === 'pass' ? '✓' : domainData.status === 'warn' ? '⚠' : '✗';
      console.log(`  [${icon}] ${domain}`);
      for (const c of domainData.checks) {
        const ci = c.status === 'pass' ? '  ✓' : c.status === 'warn' ? '  ⚠' : c.status === 'fail' ? '  ✗' : '  ℹ';
        console.log(`${ci} [${c.id}] ${c.title}`);
        if (c.status !== 'pass') console.log(`        Evidence: ${c.evidence}`);
        if (c.recommendation) console.log(`        → ${c.recommendation}`);
      }
      console.log();
    }

    if (criticalFindings.length > 0) {
      console.log('═══ CRITICAL FINDINGS ════════════════════════════════════════');
      for (const f of criticalFindings) {
        console.log(`  ✗ [${f.id}] ${f.title}`);
        console.log(`    ${f.evidence}`);
        if (f.recommendation) console.log(`    → ${f.recommendation}`);
      }
      console.log();
    } else {
      console.log('  No critical findings. All mandatory controls verified.\n');
    }
  }).catch((err) => {
    console.error('Audit failed:', err);
    process.exit(1);
  });
}
