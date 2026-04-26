# CSRF and session cookies (P5-12)

**Implementation:** [authToken.ts](../../Collect-RX-main/src/server/authToken.ts)

| Setting | Value | Rationale |
|---------|--------|-----------|
| `httpOnly` | true | JS on your SPA cannot read the token; mitigates theft via XSS |
| `sameSite` | Lax | Default; cookie not sent on cross-site **subresource** requests; top-level cross-site GET can send cookie (navigations) — acceptable for this API shape |
| `secure` | true in production | HTTPS only |

**CORS** ([index.ts](../../Collect-RX-main/src/server/index.ts)): `ALLOWED_ORIGINS` list; browser will not add credentialed fetches from random origins if not listed.

**CSRF vs this stack:** the session API uses **JSON** `PUT`/`POST` with `credentials: 'include'`. A malicious *other* origin cannot read the httpOnly cookie, so classic CSRF from a third-party *forged form* to your API is harder than cookie-less sessions. If you add **server-rendered** HTML forms to the *same* API or loosen CORS, reassess and consider **CSRF token** or `SameSite=Strict` for the session cookie.

**Test:** not automated; manual: confirm you cannot call `/api/...` from a random origin with browser creds.
