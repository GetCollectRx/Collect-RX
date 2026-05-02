# CollectRx platform — Obsidian handoff

> **Last updated:** 2026-04-22. This note is the **entry point** for this vault when working in **`collectrx-platform`**.  
> The older content below the line about “Graph corpus” described a **legacy Electron + SQLite** tree; the **shipping product** lives under **`Collect-RX-main/`** (Vite + Express + Prisma + **PostgreSQL**). See the repo’s ADR and README for authority.

---

## Source of truth (repo root, one level up from this vault)

| Doc | Purpose |
|-----|---------|
| `OUTSTANDING-FIXES-PRODUCT-READY.md` | Phased backlog: what’s done vs next (Phases 1–9) |
| `docs/adr/0001-primary-application-stack.md` | Canonical stack: **Collect-RX-main** is the app |
| `docs/product/PHASE9-GTM.md` | Public routes (`/legal/*`, `/product`, `/changelog`), cookie key, changelog data file |
| `docs/product/MVP-SCOPE.md` | MVP and non-goals |
| `Collect-RX-main/README.md` | Run, seed, test, Stripe/reminders/worker notes |
| [[_MOC_COMMUNITY_Modules]] | Map of content for `_COMMUNITY_* Module` notes (intentional cross-links) |

*Obsidian tip:* This vault folder is `collectrx-platform/obsidian/`. To open the files above, use your editor or attach the **parent folder** as a second vault if you need wikilinks to the whole repo.

---

## Phase status (summary — detail in OUTSTANDING)

- **P1–P2:** Product/stack decisions, monorepo, CI, Postgres, migrations — **in place** (see OUTSTANDING status blocks).
- **P3:** Core journeys — **complete** for in-scope items (Appendix C in OUTSTANDING).
- **P4–P6:** Integrations, compliance, ops — **docs + much code**; some items are **operator/legal** (BAAs, pen test, etc.).
- **P7:** QA, E2E on CI, k6 sample, a11y/i18n docs — **per OUTSTANDING**.
- **P8:** BullMQ + Redis worker path, idempotent reminders — **per OUTSTANDING / PHASE8 doc**.
- **P9 (GTM & polish):** In-app `HelpTip` (3+ screens), Terms/Privacy pages + `CookieBanner`, sign-in + sidebar links, `AdminOnboardingChecklist`, product one-pager, customer changelog — **wired in `App.tsx` and related files**; legal copy is **template** (counsel before prod).

**Next work:** Whatever OUTSTANDING lists as still open *after* Phase 9 (e.g. remaining P4–P6 operator rows, or new epics) — not “Phase 5 UI redesign” from a legacy plan.

---

## Stack (canonical app: `Collect-RX-main/`)

| Layer | Tech |
|-------|------|
| UI | React, TypeScript, Vite, Tailwind-style utility classes in components |
| API | Express (`src/server`), `/api` routes |
| Data | Prisma 5, **PostgreSQL** (`DATABASE_URL`) |
| Auth | Practice-scoped session/JWT (see compliance docs) |
| Payments / comms | Stripe, SendGrid, Twilio, etc. (env-driven) |
| Jobs | In-process or **BullMQ + `npm run worker`** when `REDIS_URL` is set |

---

## Dev commands (from `Collect-RX-main/`)

```bash
npm install    # from repo root use workspace install per root README
cd Collect-RX-main
cp .env.example .env   # then set DATABASE_URL, JWT_SECRET, …
npm run db:generate && npm run db:migrate:dev
npm run db:seed
npm run dev
npm run typecheck && npm run lint && npm test
```

E2E: build + `npm start`, seed practice id, `npm run e2e` (see `Collect-RX-main/README.md`).

---

## Knowledge graph / auto-generated notes in this vault

- **Cursor:** This repo includes **`.cursor/rules/obsidian-vault-context.mdc`** (`alwaysApply: true`) so agents **consult this vault** with `OUTSTANDING` and `Collect-RX-main`. Full map: **`CURSOR-REFERENCE.md`**; alphabetical list: **`VAULT-FILE-INDEX.txt`**.
- **`GRAPH_REPORT.md`** — graphify snapshot (dated in file header). **Nodes may reference old filenames or a prior corpus.**
- **`_COMMUNITY_*.md`**, many `ComponentName.tsx.md` files — useful for **exploration**, not guaranteed aligned with `Collect-RX-main` line-for-line.
- For implementation, **prefer** `Collect-RX-main/src` + **`OUTSTANDING-FIXES-PRODUCT-READY.md`**.

To refresh the graph from current code, re-run your **graphify** (or equivalent) pipeline against `Collect-RX-main` and this vault if you use that workflow.

---

## Legacy / non-canonical code

- Root `src/api` + `src/frontend` (or similar) may exist as a **prototype** per ADR 0001 — do not treat as primary without checking `docs/DEPRECATION.md` and `OUTSTANDING` Phase 1.

---

## If you are still using the old Electron + SQLite “Click” mental model

That is **not** the primary handoff for **collectrx-platform**. Preserve any separate repo (`khalidegeh/Click` etc.) in its own vault note if needed; this file tracks **collectrx-platform** + **Collect-RX-main** only.
