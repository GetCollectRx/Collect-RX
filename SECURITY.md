# Security Policy

## Reporting Security Issues

CollectRx takes security seriously. If you discover a security vulnerability, please email **khalidegeh97@gmail.com** with:

1. Description of the vulnerability
2. Steps to reproduce (if applicable)
3. Potential impact
4. Suggested fix (if you have one)

**Do not file public GitHub issues for security vulnerabilities.** Please report privately to allow time for patching.

---

## Secret Management

### Environment Variables

All secrets must be managed through environment variables. Never hardcode secrets in the codebase.

**Required Secrets:**
- `DATABASE_URL` — PostgreSQL connection string (required in production)
- `JWT_SECRET` — 256-bit signing key for session tokens (required in production)
- `STRIPE_SECRET_KEY` — Stripe API secret key (production)
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `VAPI_API_KEY` — Vapi.ai API key (required for voice calls)
- `SENDGRID_API_KEY` — SendGrid API key for email delivery
- `TWILIO_ACCOUNT_SID` — Twilio account identifier
- `TWILIO_AUTH_TOKEN` — Twilio authentication token

### Production Deployment

All production secrets must be set via Fly.io's secret management:

```bash
# Set a secret on Fly.io
fly secrets set -a collect-rx KEY_NAME=value

# View all secrets (does not show values)
fly secrets list -a collect-rx

# Delete a secret
fly secrets unset -a collect-rx KEY_NAME
```

**Never commit .env files to git.** Use `.env.example` as a template.

### Development

Create a local `.env` file for development:

```bash
# Copy template
cp Collect-RX-main/.env.example Collect-RX-main/.env

# Fill in test/development values
# Use Stripe test keys (sk_test_*), not production keys
```

Add `.env` to `.gitignore` (already configured).

### Test Secrets

Test keys may be included in environment examples (e.g., `TEST_STRIPE_SECRET_KEY`) because they are:
- Not production credentials
- Stripe test API keys (fully isolated from production)
- Scoped to test suites only
- Revocable without production impact

---

## Rotating Secrets

Secrets should be rotated on a regular schedule. See [`Collect-RX-main/docs/SECRET_ROTATION_SCHEDULE.md`](Collect-RX-main/docs/SECRET_ROTATION_SCHEDULE.md) for:

- Rotation frequency per secret type
- Step-by-step rotation procedures
- Rollback instructions
- Audit logging

**Monthly:** Database credentials  
**Quarterly:** JWT signing key  
**Annually:** API keys (Stripe, Vapi, SendGrid, Twilio)

---

## Automated Secret Scanning

This repository has GitHub secret scanning enabled with push protection.

### What it detects:
- Stripe keys (`sk_live_*`, `sk_secret_*`, `whsec_*`)
- GitHub tokens (`ghp_*`, `ghu_*`)
- SendGrid API keys
- Twilio credentials
- Private SSH keys and certificates
- AWS credentials

### If a secret is detected:
1. GitHub will block the push automatically
2. The scan results are visible in the commit details
3. You must either:
   - Remove the secret from the code
   - Use an environment variable instead
   - Use a test/fake value for examples

### Bypass (emergency only):
If you need to bypass secret scanning for a legitimate reason (e.g., test keys in examples):

```bash
# Document the bypass in a comment
# BYPASS: Test key only (sk_test_*) — not production

git push --no-verify  # Only as last resort
```

**Bypasses are logged and reviewed.**

---

## Code Security Standards

### Always use environment variables
```typescript
// ✅ GOOD
const apiKey = process.env.STRIPE_SECRET_KEY;
if (!apiKey) {
  throw new Error('STRIPE_SECRET_KEY environment variable not set');
}

// ❌ BAD
const apiKey = 'sk_live_abc123xyz789';
```

### Never log secrets
```typescript
// ✅ GOOD
logger.error('DB connection failed');

// ❌ BAD
logger.error(`DB connection failed: ${process.env.DATABASE_URL}`);
```

### Validate at application start
```typescript
// ✅ GOOD - Fail fast in development
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}

// ❌ BAD - Wait until secret is needed
function getJwtSecret() {
  return process.env.JWT_SECRET;
}
```

### Use environment variable helpers
```typescript
// ✅ GOOD - Clear, reusable
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} environment variable not set`);
  }
  return value;
}

const dbUrl = requireEnv('DATABASE_URL');
```

---

## Incident Response

### If a secret is exposed:

1. **Immediately notify** khalidegeh97@gmail.com
2. **Stop using** the exposed secret
3. **Revoke** the credential in the service (Stripe, Vapi, etc.)
4. **Generate** a new credential
5. **Deploy** the new credential to all environments
6. **Document** the incident in GitHub Issues (private) with timeline and response

### Post-incident review:
- Determine how the secret was exposed
- Update procedures to prevent recurrence
- Audit logs for unauthorized access
- Consider rotating other related secrets

---

## Security Dependencies

This project uses npm dependencies that may have security vulnerabilities. Regular audits are performed:

```bash
# Check for vulnerabilities
npm audit

# Fix vulnerabilities (caution: may break compatibility)
npm audit fix

# See detailed audit report
npm audit --audit-level=moderate
```

High/critical vulnerabilities must be fixed before release. Moderate vulnerabilities should be addressed within 30 days.

---

## PHI/PII Handling

CollectRx processes patient health information (PHI) and must comply with **PHIPA/PIPEDA** regulations.

### Key rules:
- **Never** store PHI in plain text
- **Never** send PHI to external services without encryption
- **Always** use UUID tokens for Vapi metadata (patient names/DOBs never sent to Vapi)
- **Encrypt at rest** using `PHI_ENCRYPTION_KEY`
- **Log sanitization** — never log patient identifiers

See [`Collect-RX-main/docs/compliance/PHI-VAPI-BOUNDARY.md`](Collect-RX-main/docs/compliance/PHI-VAPI-BOUNDARY.md) for complete PHI handling procedures.

---

## Compliance Checklist

Before deploying to production:

- [ ] All secrets are environment variables
- [ ] No `.env` files committed
- [ ] `DATABASE_URL` has `?sslmode=require` (TLS)
- [ ] Error messages don't expose credentials
- [ ] `JWT_SECRET` is set to a cryptographically random value
- [ ] All API keys are rotated annually
- [ ] Secret rotation schedule is documented
- [ ] GitHub secret scanning is enabled
- [ ] PHI is encrypted at rest (`PHI_ENCRYPTION_KEY` set)
- [ ] No test keys in production environment

---

## Additional Resources

- [Fly.io Secret Management](https://fly.io/docs/reference/secrets/)
- [OWASP: Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Stripe Security](https://stripe.com/docs/security)
- [Vapi Security](https://docs.vapi.ai/security)

---

**Last Updated:** August 15, 2026
