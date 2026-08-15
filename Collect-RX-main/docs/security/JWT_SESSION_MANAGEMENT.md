# JWT Session Management Security Fix

**Status**: Implemented (August 15, 2026)  
**Audit Finding**: #6 - JWT Expiration & Session Management (HIGH)  
**Deadline**: Met

## Overview

This document describes the JWT session management improvements addressing CollectRx Security Audit Finding #6. The fix reduces access token expiration, implements refresh token rotation, and adds session revocation on logout.

## Changes Made

### 1. Token Expiration Reduced

**Before:**
- All roles: 8-hour access tokens
- Accountants: 90-day tokens

**After:**
- All roles: 15-minute access tokens
- All roles: 7-day refresh tokens

### 2. Refresh Token Rotation

New endpoint: `POST /api/auth/refresh`

- Accepts refresh token from httpOnly cookie
- Validates refresh token signature
- Checks if refresh token is revoked
- Issues new token pair
- Revokes old refresh token (rotation prevents reuse attacks)
- Returns new 15-minute access token

```bash
# Request
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Cookie: crx_refresh=<refresh_token>"

# Response
{
  "accessToken": "<new_access_token>",
  "expiresIn": 900
}
```

### 3. Session Revocation on Logout

Updated endpoint: `POST /api/auth/logout`

- Revokes current access token via JTI (JWT ID)
- Clears both access and refresh token cookies
- Prevents token replay attacks

### 4. Token Revocation Database

New model: `RevokedToken`

```prisma
model RevokedToken {
  jti       String   @id
  revokedAt DateTime @default(now())
  expiresAt DateTime  // For cleanup of expired entries
  
  @@index([expiresAt])
}
```

**Purpose:**
- Tracks revoked tokens by JTI (JWT ID)
- Prevents use of tokens after logout
- Includes expiration for automatic cleanup
- Index on expiresAt for efficient garbage collection

### 5. Authentication Middleware Update

The `authenticate` middleware now:

1. Extracts JTI from token
2. Checks if JTI is in revoked tokens table
3. Returns 401 if token is revoked
4. Allows request to continue if not revoked

```typescript
if (jti && await isTokenRevoked(prisma, jti)) {
  res.status(401).json({ error: 'Session has been invalidated' });
  return;
}
```

## Security Properties

### Access Token (15 minutes)
- Short-lived to limit exposure window
- Revocable via JTI
- Used for API requests
- Contains: userId, practiceId, role, jti, iat, exp, iss, aud

### Refresh Token (7 days)
- Long-lived for user convenience
- Stored in httpOnly, Secure, SameSite=strict cookie
- Rotated on each refresh (old token revoked)
- Contains: userId, practiceId, role, jti, type: "refresh", iat, exp, iss

### Rate Limiting
- Login: 5 attempts / 15 minutes per IP
- Protected with `authLimiter` middleware
- Prevents credential brute-forcing

### Cookie Security
```
Set-Cookie: crx_access=<token>; HttpOnly; Secure; SameSite=Strict; Path=/
Set-Cookie: crx_refresh=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800
```

- **HttpOnly**: Prevents XSS token theft via `document.cookie`
- **Secure**: Only sent over HTTPS (production enforced)
- **SameSite=Strict**: Prevents CSRF token inclusion in cross-site requests
- **Refresh token Max-Age**: 7 days (604800 seconds)

## Implementation Files

### Core Auth
- `src/server/authToken.ts`: Token generation, revocation, JTI tracking
- `src/server/routes/authRoutes.ts`: Login, refresh, logout endpoints
- `src/server/middleware/authenticate.ts`: Token validation with revocation check

### Database
- `prisma/schema.prisma`: RevokedToken model
- `prisma/migrations/20260815000000_add_token_revocation/migration.sql`: Schema migration

### Tests
- `tests/authSecurity.test.ts`: Comprehensive token lifecycle tests

## API Changes

### Login Response (NEW)
```json
{
  "role": "practice_owner",
  "userRole": "owner",
  "expiresIn": 900,
  "user": { "id": "...", "email": "...", "displayName": "..." },
  "practice": { "id": "...", "name": "...", "timezone": "..." },
  "subscription": { ... },
  "health": { ... }
}
```

**Note**: Cookie-based sessions receive refresh token in Set-Cookie header. Desktop/mobile clients can include `X-CRX-Desktop: 1` header to receive `sessionToken` and `refreshToken` in JSON response body.

### New Endpoint: Refresh Token
```
POST /api/auth/refresh
Content-Type: application/json

# No body — uses crx_refresh cookie

Response 200:
{
  "accessToken": "<new_jwt>",
  "expiresIn": 900
}

Response 401:
{
  "error": "Invalid or expired refresh token"
}
```

### Logout (UPDATED)
```
POST /api/auth/logout
Authorization: Bearer <access_token>

Response 200:
{ "ok": true }
```

**Effect**:
- Revokes access token JTI
- Clears crx_access and crx_refresh cookies
- All subsequent requests with revoked token → 401

## Client-Side Integration

### Browser/SPA

1. **Login**: Credentials → receive accessToken + refreshToken cookie
2. **API Calls**: Include `Authorization: Bearer <accessToken>` header
3. **Token Expiration**: Browser receives 401 → call /api/auth/refresh
4. **Refresh Response**: Update Authorization header with new accessToken
5. **Logout**: POST /api/auth/logout → clears cookies, redirect to login

### Mobile/Desktop

1. **Login**: Pass `X-CRX-Desktop: 1` header
2. **Response**: Receive `sessionToken` (access) and `refreshToken` in JSON body
3. **API Calls**: Use `Authorization: Bearer <sessionToken>`
4. **Token Expiration**: Call POST /api/auth/refresh with refresh token
5. **Logout**: POST /api/auth/logout with current access token

## Maintenance

### Revoked Token Cleanup

Revoked tokens accumulate in the database. To prevent unbounded growth:

**Option 1: Periodic Cleanup Job**
```sql
DELETE FROM revoked_tokens WHERE expires_at < NOW();
```

Schedule this nightly or daily via:
- Cron job
- Database-level trigger
- Background job (BullMQ)

**Option 2: Automatic Cleanup (Recommended)**
```sql
-- Drop old index if it exists
DROP INDEX IF EXISTS "revoked_tokens_expires_at_idx";

-- Create index that PostgreSQL can use for cleanup
CREATE INDEX "revoked_tokens_expires_at_idx" ON "revoked_tokens"("expires_at");

-- Set up periodic maintenance (add to application startup or Fly.io deployment hook)
-- FROM: Scheduled job that runs daily
-- QUERY: DELETE FROM revoked_tokens WHERE expires_at < NOW() - INTERVAL '1 day';
```

### Monitoring

Track these metrics:
- Active sessions (distinct JTIs in revoked_tokens table with expiresAt > now)
- Refresh token usage (count of /api/auth/refresh calls)
- Logout frequency
- Token expiration errors (401 responses from /api/auth/*)

## Testing Checklist

- [x] Access token TTL = 15 minutes
- [x] Refresh token TTL = 7 days
- [x] Refresh token in httpOnly, secure, sameSite=strict cookie
- [x] Logout revokes access token
- [x] Refresh token rotation working (old token revoked on new request)
- [x] Rate limiting: 5 failed attempts = 15-minute lockout
- [x] Token revocation checked on every request
- [x] JTI included in both token types
- [x] Revoked tokens persisted in database

## Deployment Steps

1. **Database Migration**
   ```bash
   npm run db:migrate:collectrx
   ```

2. **Verify in Staging**
   - Test login flow
   - Test token refresh
   - Test logout revocation
   - Verify cookie attributes in DevTools

3. **Monitor Production**
   - Check error logs for "Session has been invalidated"
   - Monitor /api/auth/refresh endpoint usage
   - Track database size of revoked_tokens table

## Related Issues

- Security Audit Finding #6: JWT Expiration & Session Management
- Fixes HIGH severity finding
- Complements existing rate limiting and CSRF protection

## Future Enhancements

1. **Device Management**: Allow users to revoke all sessions except current
2. **Concurrent Session Limits**: Enforce max N simultaneous logins per user
3. **Token Binding**: Bind tokens to IP/user-agent (prevent cross-network token theft)
4. **Biometric Refresh**: Require fingerprint/face to refresh on mobile
5. **Activity-Based Expiration**: Extend TTL only on active use (no extension on idle)
