# Ingest & Queue: How Claims Get From a Practice Into a Call

**Status:** Current
**Context:** [Wave 1 — website vs. app boundary](../../CLAUDE.md)

## The core constraint

CollectRx runs in the browser. A browser cannot reach a practice's LAN — it has no path to a
SQL Server instance sitting on an office PC behind a router. So automated ingest from a
practice's PMS is always a **push**, initiated from inside the practice's network, never a
pull initiated by the cloud. There are exactly two ways data gets pushed in:

1. **Manual CSV export/import** (`/import`) — a person exports from their PMS and uploads the
   file in the browser. Works for any PMS. This is the default, primary path.
2. **An optional local sync agent** — a small headless process running on a practice PC that
   extracts and POSTs data to the CollectRx API on its own schedule. Currently shipped for
   AbelDent (`desktop/services/abeldent-sync.js`) as one connector; the pattern generalizes to
   any PMS with a queryable local database. It is infrastructure, not a second product — there
   is no UI to log into, no dashboard to check, just a scheduled push.

Both paths land in the same place: rows in `insuranceClaim`, via the same import pipeline.

## Pipeline

```
CSV upload (/import)  ─┐
                        ├──▶ runPmsImportPipeline()  ──▶  syncWorkItemsForPractice()  ──▶  queueEngine
Sync agent POST        ─┘        (src/server/pms/               (src/server/services/       (src/server/
                                   pmsImportPipeline.ts)           workQueueService.ts)         frontDesk/
                                                                                                 queueEngine.ts)
```

- `runPmsImportPipeline()` parses, validates, and upserts claims for a practice — regardless of
  whether the source was a CSV upload or a connector push. On success it calls
  `syncWorkItemsForPractice(prisma, practiceId)` directly (`pmsImportPipeline.ts:112`), which
  enrolls eligible claims into the work/call queue. **Import already enrolls claims into the
  queue — there is no separate "turn on calling" step for newly imported claims.**
- The queue engine (`queueEngine.ts`) is a completely separate scheduler from whatever cadence
  a practice's local sync agent runs on. It only dispatches calls Monday–Friday, 8am–5pm
  Eastern (`isWithinCallWindow()`), respects the per-carrier `CARRIER_BLOCK` flag, caps at 3
  attempts per claim, and skips claims under 30 days old / escalates claims over 90 days old to
  a human. A practice's sync agent can run hourly, nightly, or not at all (CSV-only) — it has no
  effect on when calls happen.

## Why the schedules are decoupled on purpose

If local sync and call dispatch were the same schedule, a practice with a flaky or unconfigured
sync agent would silently stop getting calls made — with no visible failure. Keeping them
separate means: import claims whenever data is available (CSV today, sync push tonight,
whatever), and the queue engine picks up anything eligible on its own fixed cadence.

## The desktop agent, concretely

`desktop/services/abeldent-sync.js` is the reference implementation of "practice sync agent":
read `ABELDENT_SCHEMA_MAP` for the practice's schema mapping, query SQL Server on the practice
PC, POST the resulting rows to the Fly API. It requires `ABELDENT_SCHEMA_MAP` to be set
to activate — without it, nothing runs, and the server operates fully on CSV import alone (see
`CLAUDE.md` → "Abeldent Connector (Phase 4)"). Treat this file as the pattern to copy for a
future PMS-specific agent, not as a peer product practices are expected to install by default.
