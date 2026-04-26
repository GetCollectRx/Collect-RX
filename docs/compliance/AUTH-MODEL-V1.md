# CollectRx v1 — Authentication & tenancy model

**Status:** In effect for the canonical `Collect-RX-main` app (2026-04-22)

## Summary

- **v1** uses a **per-practice shared login** (one password per `Practice` row). There is **no** end-user (staff) table or per-user roles in the database.
- **Session:** HTTP-only cookie + signed JWT (practice-scoped). API routes that serve PHI use the `authenticate` middleware.
- **Implications:** All staff using the same practice credentials share one identity. Audit logs that rely on “which user” should be augmented if your compliance program requires per-person accountability before handling regulated data at scale.

## Backlog status (product)

- **P3-01** — **Closed for v1:** shared practice credential only; no `User` table. Revisit when per-staff audit is required.
- **P3-02** — **Deferred** until a `User` model exists; password reset is N/A for practice-only login.
- **P3-03** — **Implemented (v1):** `POST /api/auth/login` is rate-limited (e.g. 30 attempts / 15 minutes) with 429 + standard rate-limit headers; see `loginLimiter` in `Collect-RX-main/src/server/index.ts`. Optional: structured metrics on blocks (backlog / P6).
- **P3-05** — **Deferred** while each deployment uses a **single practice** per environment; a switcher needs a `User` → many `Practice` membership model.

## Future (not v1)

If you introduce **User** accounts, add: password reset, role matrix (admin vs read-only), practice membership, and stricter rate limits per identity.

## Related

- [PHI_DATA_CLASSIFICATION.md](../PHI_DATA_CLASSIFICATION.md)
- [ENVIRONMENT-MATRIX.md](../ENVIRONMENT-MATRIX.md)
