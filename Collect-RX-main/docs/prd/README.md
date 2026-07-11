# CollectRx — Product Requirements Documents

Product requirements for every build phase. These are the source of truth — Notion links here.

**Platform scope (2026):** CollectRx is **multi-tenant SaaS** — any Canadian dental practice signs up, creates a tenant, and imports data via CSV or PMS connector. PRDs refer to a **pilot practice** generically (first onboarded site); do not hardcode practice names in code, seeds, or env. Per-tenant identity (name, phone, NPI) lives in the `Practice` database row and Admin UI.

## Phase Index

| Phase | File | Status |
|-------|------|--------|
| Phase 0 | [phase-0-platform-foundation.md](./phase-0-platform-foundation.md) | ✅ Complete |
| Phase 1–2 | [phase-1-2-core-platform-electron.md](./phase-1-2-core-platform-electron.md) | ✅ Complete |
| Phase 3 | [phase-3-eligibility-rules-engine.md](./phase-3-eligibility-rules-engine.md) | ✅ Complete |
| Phase 4 | [phase-4-windows-installer-schema-discovery.md](./phase-4-windows-installer-schema-discovery.md) | ✅ Engineering complete (live session pending) |
| Phase 5 | [phase-5-ui-ux-redesign.md](./phase-5-ui-ux-redesign.md) | ✅ Pilot-ready v1 |
| Phase 6 | [phase-6-learning-and-implementation.md](./phase-6-learning-and-implementation.md) | 🚧 In progress |
| Phase 7 | [phase-7-pilot-go-live.md](./phase-7-pilot-go-live.md) | ⏳ Pending |
