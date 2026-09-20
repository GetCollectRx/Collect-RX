# Postmortem: <short incident title>

Copy this file to `docs/runbooks/postmortems/YYYY-MM-DD-short-slug.md` and fill it in within 48 hours of resolution, while detail is still fresh. Blameless — the goal is to find what let the failure happen, not who caused it.

## Summary

- **Date / time (Eastern):** start — end
- **Duration:** total time impact was live
- **Severity:** critical / high / medium (match the alert catalog's `severity`, `Collect-RX-main/src/server/observability/alertCatalog.ts`)
- **Alert ID(s) fired:** e.g. `queue_dispatch_stalled`
- **Practices affected:** all / specific practice IDs / none (internal-only)
- **Runbook used:** link to the specific runbook in `docs/runbooks/`

## Impact

What actually happened to practices, patients' claims, or carrier calls — in plain language, not internals. Quantify where possible (calls not dispatched, claims delayed, minutes of downtime).

## Timeline (Eastern time)

| Time | Event |
|---|---|
| | First alert fired / first symptom observed |
| | Incident acknowledged |
| | Root cause identified |
| | Mitigation applied |
| | Confirmed resolved |

## Root cause

The actual mechanism — not "the database was slow," but why it was slow, and why nothing caught it sooner.

## What went well

## What went poorly

## Action items

| Action | Owner | Due | Tracking (issue link) |
|---|---|---|---|
| | | | |

Every action item must have an owner and a due date, or it will not happen. If the runbook that was used turned out to be wrong, incomplete, or pointed at a stale command/endpoint, fixing that runbook is itself an action item — see the "keep runbooks honest" note in `docs/runbooks/README.md`.
