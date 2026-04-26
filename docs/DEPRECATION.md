# Deprecation and non-canonical code (P1-07)

**Status:** In effect as of 2026-04-22 (aligns with [ADR 0001: Primary application stack](adr/0001-primary-application-stack.md)).

## What is deprecated for new product work

The following paths are **not** the target for new customer-facing features or production hardening unless a future ADR says otherwise:

| Path | Why |
|------|-----|
| `src/api/` (repo root) | In-memory `db.ts`; not the same persistence model as Prisma in `Collect-RX-main/`. |
| `src/frontend/` (repo root) | Tied to the in-memory API; duplicates UI concepts. |

**Allowed changes without an ADR:** small fixes (security, broken build, typing), **documentation**, or code that is clearly labeled experimental and not merged to “main” product release branches.

**Requires ADR or explicit product approval:** new endpoints, new screens, or new business behavior that only exist under root `src/`.

## If you need a feature

1. **Prefer implementing it in `Collect-RX-main/`** (Prisma models, `src/server`, `src/pages`).
2. If the prototype has a good idea, **port** the idea (not necessarily line-by-line copy) into the canonical app.
3. If you believe the **root** stack should become primary, open a **discussion** and a **draft ADR** that supersedes ADR 0001.

## When opening an issue or PR (non-canonical)

Use the GitHub issue template **Non-canonical stack (root `src/`)** in [`../.github/ISSUE_TEMPLATE/non_canonical_stack.md`](../.github/ISSUE_TEMPLATE/non_canonical_stack.md) (or the checklist below) so maintainers can triage quickly.

**Checklist (copy into PR description if no template available):**

- [ ] I confirm this change is **not** new product surface area, **or** I have a link to an ADR / product approval
- [ ] I confirm **Collect-RX-main** was considered for the same change first
- [ ] If this is a security or build fix, describe the minimal scope

## Related

- [../src/README.md](../src/README.md) — one-line notice at folder entry
- [MVP-SCOPE.md](product/MVP-SCOPE.md) — v1 non-goals
