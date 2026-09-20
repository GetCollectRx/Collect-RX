# Secret Rotation Schedule

This document tracks the rotation schedule for all secrets used by CollectRx. Regular rotation is essential for maintaining security.

**Last Updated:** August 15, 2026

## Rotation Policies

### High-Risk Secrets (Monthly)
Secrets that could expose PHI, payment data, or critical infrastructure:
- Database credentials
- API keys for external services

### Medium-Risk Secrets (Quarterly)
Authentication secrets that are less frequently exposed:
- JWT signing keys
- Webhook secrets

### Low-Risk Secrets (Annual)
Public-facing tokens with limited exposure:
- API credentials for non-sensitive services

---

## Active Secrets

### Database Credentials
- **Service:** PostgreSQL (Fly.io)
- **Rotation Policy:** Monthly
- **Last Rotated:** August 15, 2026
- **Next Rotation:** September 15, 2026
- **Owner:** Khalid Egeh
- **Notes:** Set via `fly secrets set -a collect-rx DATABASE_URL`

### JWT Signing Secret
- **Service:** CollectRx Authentication
- **Rotation Policy:** Quarterly (every 3 months)
- **Last Rotated:** August 15, 2026
- **Next Rotation:** November 15, 2026
- **Owner:** Khalid Egeh
- **Notes:** 
  - Generate new key: `openssl rand -hex 32`
  - Keep old keys for 2 weeks to avoid invalidating active tokens
  - Set via `fly secrets set -a collect-rx JWT_SECRET=<new-key>`

### Stripe API Keys
- **Service:** Stripe (Payment processing)
- **Rotation Policy:** Annual (at minimum)
- **Last Rotated:** August 15, 2026
- **Next Rotation:** August 15, 2027
- **Owner:** Khalid Egeh
- **Credentials:**
  - `STRIPE_SECRET_KEY` (production sk_live_*)
  - `STRIPE_WEBHOOK_SECRET` (whsec_*)
- **Notes:**
  - Dashboard: https://dashboard.stripe.com/apikeys
  - Webhook endpoint: https://dashboard.stripe.com/webhooks
  - Always use test keys (sk_test_*) for development

### Vapi API Key
- **Service:** Vapi.ai (Voice agents)
- **Rotation Policy:** Annual (at minimum)
- **Last Rotated:** August 15, 2026
- **Next Rotation:** August 15, 2027
- **Owner:** Khalid Egeh
- **Notes:**
  - Dashboard: https://dashboard.vapi.ai/settings/api-keys
  - Set via `fly secrets set -a collect-rx VAPI_API_KEY=<new-key>`

### SendGrid API Key
- **Service:** SendGrid (Email delivery)
- **Rotation Policy:** Annual (at minimum)
- **Last Rotated:** August 15, 2026
- **Next Rotation:** August 15, 2027
- **Owner:** Khalid Egeh
- **Notes:**
  - Dashboard: https://app.sendgrid.com/settings/api_keys
  - Set via `fly secrets set -a collect-rx SENDGRID_API_KEY=<new-key>`

### Twilio Credentials
- **Service:** Twilio (SMS/Voice)
- **Rotation Policy:** Annual (at minimum)
- **Last Rotated:** August 15, 2026
- **Next Rotation:** August 15, 2027
- **Owner:** Khalid Egeh
- **Credentials:**
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
- **Notes:**
  - Dashboard: https://console.twilio.com/account/keys-credentials
  - Use "API Key" type (not primary account token)

### Notion API Key (Optional)
- **Service:** Notion (Learning loop integration)
- **Rotation Policy:** Annual (at minimum)
- **Last Rotated:** August 15, 2026
- **Next Rotation:** August 15, 2027
- **Owner:** Khalid Egeh
- **Notes:** Only required if LEARNING_LOOP_ENABLED=1

---

## Test Secrets

### Test Stripe Keys
- **Usage:** Vitest suite and self-tuner rule validation
- **Keys:**
  - `TEST_STRIPE_SECRET_KEY`: sk_test_4eC39HqLyjWDarjtT1zdp7dc
  - `TEST_STRIPE_WEBHOOK_SECRET`: whsec_test_00000000000000000000000000000000
- **Policy:** Not production credentials; safe to keep in code
- **Rotation:** Only rotate if tests fail due to key validation

---

## Rotation Procedures

### Step-by-Step Rotation Process

1. **Generate New Secret**
   ```bash
   # For JWT_SECRET
   openssl rand -hex 32
   
   # For other keys, visit the service dashboard
   ```

2. **Backup Current Secret**
   - Note the current secret in a secure location
   - Keep for rollback purposes (24 hours minimum)

3. **Update Fly.io Secrets**
   ```bash
   fly secrets set -a collect-rx KEY_NAME=new-value
   ```

4. **Verify Deployment**
   ```bash
   # Monitor logs for errors
   fly logs -a collect-rx --follow
   
   # Test health endpoint
   curl https://collect-rx.fly.dev/api/health
   ```

5. **Revoke Old Secret**
   - Remove old key from service (Stripe, Vapi, etc.)
   - Keep audit log of when rotation occurred

6. **Document**
   - Update this file with new rotation date
   - Note any issues encountered

### Rollback Procedure

If rotation causes issues:

1. Restore old secret to Fly.io
2. Restart the app
3. Investigate root cause
4. Retry rotation with debugging enabled

---

## Alert System

Rotation reminders are sent on:
- 7 days before rotation date
- Day of rotation
- If rotation is overdue (red flag)

Set calendar reminders for:
- September 15, 2026 (Database)
- November 15, 2026 (JWT)
- August 15, 2027 (Stripe, Vapi, SendGrid, Twilio)

---

## Compliance Notes

- All rotations must be logged in this file
- No secrets should be stored in .env files in production
- Use Fly.io's secret management exclusively
- Test keys may be committed to .env.example (no production values)

---

## Contact

**Rotation Authority:** Khalid Egeh (khalidegeh97@gmail.com)

For questions or to report a compromised secret, immediately notify Khalid and rotate that secret.
