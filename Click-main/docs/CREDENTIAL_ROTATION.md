# Credential Rotation & AWS Parameter Store Setup

**Date:** April 8, 2026
**Status:** ✅ Implementation Complete

## Overview

CollectRx now uses **AWS Parameter Store** to securely manage credentials in production. This eliminates the need to store secrets in `.env` files or Git, significantly improving security.

### Why This Matters
- ✅ **No plaintext secrets in Git** — eliminates the risk of exposed credentials in repositories
- ✅ **Encrypted storage** — Parameter Store uses AWS KMS encryption by default
- ✅ **Audit logging** — CloudTrail logs all secret access
- ✅ **Easy rotation** — Update a parameter value, restart the app
- ✅ **Development flexibility** — Local `.env` still works for development

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   CollectRx App (Node.js)                    │
├─────────────────────────────────────────────────────────────┤
│                   awsConfig.ts (NEW)                          │
│  Fetches secrets from Parameter Store or .env                │
└────────┬────────────────────────────────┬────────────────────┘
         │                                │
    ┌────▼────┐                    ┌─────▼──────┐
    │   Dev   │                    │ Production │
    │  .env   │                    │  Parameter │
    │  File   │                    │   Store    │
    └─────────┘                    │  (AWS)     │
                                   └────────────┘
```

---

## Stored Credentials

Your secrets are now stored in AWS Parameter Store under the `/collectrx/` prefix:

| Parameter Name | Type | Value |
|---|---|---|
| `/collectrx/vapi/api-key` | SecureString | Your Vapi API key |
| `/collectrx/database/url` | SecureString | PostgreSQL connection string |
| `/collectrx/vapi/webhook-secret` | SecureString | Webhook validation secret |

**Access:** AWS Console → Systems Manager → Parameter Store

---

## Code Changes

### 1. **New File: `src/server/awsConfig.ts`**

Handles credential fetching with fallback logic:
- **Production (Railway):** Fetches from AWS Parameter Store
- **Development:** Reads from local `.env` file

```typescript
async function loadSecretsFromParameterStore(): Promise<AppSecrets>
```

### 2. **Updated: `src/server/index.ts`**

Wrapped initialization in async function to load secrets before starting the server:

```typescript
async function initializeApp() {
  const secrets = await loadSecretsFromParameterStore();
  // Set environment variables for downstream services
  process.env.VAPI_API_KEY = secrets.VAPI_API_KEY;
  startServer();
}

initializeApp();
```

### 3. **New File: `.env.example`**

Safe template for developers (no real credentials):

```env
VAPI_API_KEY=your-vapi-api-key-here
DATABASE_URL=postgresql://user:password@localhost:5432/collectrx
```

### 4. **Updated: `package.json`**

Added AWS SDK dependency:

```json
"@aws-sdk/client-ssm": "^3.410.0"
```

---

## Setup Instructions

### **For Local Development**

1. **Create `.env` file** (based on `.env.example`):
   ```bash
   cp .env.example .env
   ```

2. **Fill in local values:**
   ```env
   VAPI_API_KEY=your-local-vapi-key
   DATABASE_URL=postgresql://localhost:5432/collectrx
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Run the app:**
   ```bash
   npm run dev
   ```

### **For Production (Railway)**

1. **AWS Parameter Store is already configured** with your credentials

2. **Ensure IAM permissions:** Your Railway deployment needs an IAM role with:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "ssm:GetParameter",
         "Resource": "arn:aws:ssm:us-east-1:ACCOUNT-ID:parameter/collectrx/*"
       }
     ]
   }
   ```

3. **Deploy:** Push to Railway normally
   ```bash
   git push
   ```

4. **Verify:** Check logs for `✅ Secrets loaded successfully`

---

## Rotating Credentials

### **Scenario 1: Rotate Vapi API Key**

1. **Vapi Dashboard:**
   - Go to [https://dashboard.vapi.ai](https://dashboard.vapi.ai)
   - Generate new API key
   - Revoke old key

2. **AWS Parameter Store:**
   - Go to AWS Console → Systems Manager → Parameter Store
   - Find `/collectrx/vapi/api-key`
   - Click "Edit"
   - Paste new key, save

3. **Deploy:**
   - Push changes (no code changes needed)
   - New credential is live immediately on restart

### **Scenario 2: Rotate Database Password**

1. **Railway:**
   - Go to Railway → CollectRx Project → PostgreSQL
   - Reset password

2. **AWS Parameter Store:**
   - Update `/collectrx/database/url` with new password in connection string
   - Save

3. **Deploy:**
   - Restart the app (no code changes needed)

### **Scenario 3: Add New Secret (e.g., Stripe API Key)**

1. **Create Parameter:**
   - AWS Parameter Store → Create Parameter
   - Name: `/collectrx/stripe/secret-key`
   - Type: `SecureString`
   - Value: Your key
   - Save

2. **Update Code:**
   - Modify `awsConfig.ts` to load the new secret:
     ```typescript
     const stripeSecretKey = await getSecret('/collectrx/stripe/secret-key');
     ```

3. **Use in App:**
   ```typescript
   process.env.STRIPE_SECRET_KEY = stripeSecretKey;
   ```

---

## Security Best Practices

✅ **Do:**
- Keep `.env` in `.gitignore` (already configured)
- Rotate credentials quarterly
- Use IAM roles for app permissions (not access keys)
- Enable CloudTrail logging for audit trails
- Use strong, unique secrets

❌ **Don't:**
- Commit `.env` to Git
- Hardcode secrets in code
- Share credentials in Slack/email
- Use the same secret across environments
- Commit AWS credentials

---

## Troubleshooting

### **Error: "Parameter not found"**
- Verify parameter exists in AWS Parameter Store
- Check parameter name spelling and path (`/collectrx/...`)
- Confirm IAM role has `ssm:GetParameter` permission

### **Error: "Failed to decrypt parameter"**
- Verify KMS key permissions for your IAM role
- Check if the parameter is using the correct KMS key

### **Local Dev: Falling back to .env**
- This is normal! When `NODE_ENV !== 'production'`, the app reads `.env`
- Make sure `.env` file exists and has valid values

### **Production: Still reading .env**
- Ensure `RAILWAY_ENVIRONMENT` or `NODE_ENV=production` is set in Railway
- Check app logs for `🔐 Loading secrets from AWS Parameter Store`

---

## Files Changed

```
Click-main/
├── src/server/
│   ├── index.ts                  (MODIFIED - added async init)
│   └── awsConfig.ts              (NEW - Parameter Store integration)
├── .env.example                  (NEW - safe template)
├── package.json                  (MODIFIED - added AWS SDK)
├── .gitignore                    (UNCHANGED - .env already ignored)
└── CREDENTIAL_ROTATION.md        (NEW - this file)
```

---

## Next Steps

1. ✅ **Local Development:** Test the app with `.env` file
   ```bash
   npm run dev
   ```

2. ✅ **Verify AWS Parameter Store:**
   - Check that both parameters exist in AWS
   - Confirm IAM role permissions

3. ✅ **Deploy to Railway:**
   ```bash
   git push
   ```

4. ✅ **Monitor First Deployment:**
   - Watch Railway logs for `✅ Secrets loaded successfully`
   - Test API endpoints to confirm everything works

5. ✅ **Git Cleanup (Optional):**
   - If you had exposed credentials in Git history, consider:
     ```bash
     git filter-repo --invert-paths --path .env
     git push origin --force-with-lease
     ```
     ⚠️ Warning: This affects all collaborators. Coordinate with team first.

---

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review AWS Parameter Store documentation: https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store.html
3. Check app logs for specific error messages
4. Verify IAM permissions in AWS Console

---

**Last Updated:** April 8, 2026
**Status:** ✅ Ready for Production
