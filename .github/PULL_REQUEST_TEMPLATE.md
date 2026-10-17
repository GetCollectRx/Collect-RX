## Summary

<!-- What changed and why. The diff shows the "what" — focus this on the "why". -->

## Test plan

<!-- Commands you ran and what they showed. "Read it and it looks right" is not a test plan. -->

- [ ] `npm run ci:collectrx` (typecheck, lint, test, build) passes locally
- [ ] New behavior has test coverage — no untested paths shipped to `main`
- [ ] For UI/frontend changes: exercised in a running browser (golden path + edge cases), not just typechecked

## Database migrations (skip this section if none)

Migration bugs here don't surface until a real deploy against the real database — see the
2026-08-24 `idx_email_events_timestamp` incident, where a migration written against an assumed
schema state failed in production because prior undocumented changes had already drifted it.

- [ ] Verified against actual current prod/staging schema state, not just a fresh
      `prisma migrate dev` shadow database — assumptions about what already exists were checked,
      not asserted
- [ ] Every `DROP`/`RENAME` is conditional (`IF EXISTS`, or an existence-checked `DO` block for
      `ALTER INDEX ... RENAME`, which has no `IF EXISTS` form) unless you have verified the
      target unconditionally exists
- [ ] `CREATE INDEX`/`CREATE TABLE` uses `IF NOT EXISTS` unless you have verified the target
      unconditionally does not exist

## New or changed infra prerequisites (skip if none)

<!-- Fly volumes, secrets, or other one-time provisioning this PR's deploy now requires. -->
<!-- Example: fly volumes create collectrx_app_logs -a collect-rx -r yyz --size 1 -->

- [ ] Any new requirement is called out explicitly above, not left for the deploy to discover

## Compliance checklist (Collect-RX-main/CLAUDE.md — skip lines that don't apply, don't delete them silently)

- [ ] No PHI (patient names, DOBs, health card numbers) in Vapi `metadata` — UUID tokens only;
      PHI needed for carrier lookup crosses only as ephemeral call `variables` at dispatch time
- [ ] No hardcoded practice names, emails, or credentials in code, seeds, fixtures, or docs
- [ ] Code touching call scheduling, retry logic, or Vapi webhooks checks `CARRIER_BLOCK` first
- [ ] Code touching outreach sends respects `OUTREACH_KILL_SWITCH` and `OUTREACH_MAX_WEEKLY_SENDS`
- [ ] Zero `any`, zero new lint errors, no `TODO`/`FIXME` left in the diff

## Docs

- [ ] Updated `CLAUDE.md` / `docs/operations/PATH-TO-DELIVERY.md` in this same change if it
      changes canonical state — don't leave a second stale copy of the truth
