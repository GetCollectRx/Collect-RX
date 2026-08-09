# Fly region verification

**Status: new tooling, added 2026-08-09, not yet run against the live `collect-rx` Fly app.** This document describes what the script does and how to run it — it is not a record of any verification that has already happened. `Collect-RX-main/fly.toml`'s `primary_region` has always read `'yyz'` in this repo's history, but nothing in this repo can confirm from the outside where the live Fly machines actually run — that requires `flyctl` and real Fly auth, neither of which is available in the sandbox this tooling was built in.

## What it checks

`Collect-RX-main/scripts/ops/verify-fly-region.sh`:

1. Confirms `flyctl` is installed (prints `flyctl not found — install it first: https://fly.io/docs/flyctl/install/` and exits 1 if not, rather than crashing).
2. Parses `app` and `primary_region` out of `Collect-RX-main/fly.toml` — neither value is hardcoded in the script, so it stays correct if the app is renamed or moved regions.
3. Runs `fly machine list -a <app> --json` to get the live machines and their actual `region` field.
4. Compares every machine's region against `primary_region`.
5. Prints `PASS: all machines are running in primary_region '<region>'.` and exits 0 if they all match.
6. Prints `FAIL: machine(s) not in primary_region '<region>':` followed by the specific machine IDs and their actual regions, and exits 1, if any don't match (or if any step above errors).

Exit codes are intentionally script/CI-friendly: 0 only on a confirmed, all-match PASS; 1 on FAIL, a missing `flyctl`/`jq`, or any other error.

## How to run it

From `Collect-RX-main/`, with `flyctl` installed and authenticated (`fly auth login`) against an account with access to the `collect-rx` app:

```bash
./scripts/ops/verify-fly-region.sh
```

No arguments needed — the app name and expected region both come from `fly.toml`.

## What this repo cannot yet tell you

As of this writing, no session with real Fly credentials has run this script. Until an operator does:

- Whether the live `collect-rx` machines are actually in `yyz` (or anywhere else) is **unverified** — `fly.toml` stating `primary_region = 'yyz'` is a declared intent, not proof of where machines are actually scheduled today.
- This document does not claim a PASS or a FAIL. The first real run's output is the first real evidence either way, and whoever runs it should update this section (or note the result in `Collect-RX-main/tasks/lessons.md`, per that file's ground-truth rule) rather than leave this paragraph as the only record.

## Related

- [`CREDENTIAL-ROTATION-PILOT.md`](CREDENTIAL-ROTATION-PILOT.md) — the two companion rotation scripts (`rotate-vapi-webhook-secret.sh`, `rotate-twilio-auth-token.sh`) in the same `scripts/ops/` directory, same "new, unexecuted" status.
- `Collect-RX-main/fly.toml` — source of `app` and `primary_region`.
