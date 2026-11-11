# Simulation harness, Stage 1

Runs the real CollectRx pipeline (import, triage, dispatch, webhook, scribe, outcome, metering, learning loop) against a fake carrier, offline. No keys, no calls, $0.

## What it is

| File | Role |
|---|---|
| `stage1.e2e.test.ts` | The run: Steps 1 to 9 of the harness brief, plus gap 3 (takeover) and the CARRIER_BLOCK dispatch check |
| `fakeCarrier.ts` | The fake carrier: the Vapi server messages a real call would produce, with IVR prompts read from `Collect-RX-main/carriers/*.json` and five scripted rep personas |
| `outboundInterceptor.ts` | Replaces `fetch` and guards `http`/`https` for the run. Vapi, Anthropic and recording-delete requests get stub responses and are recorded; anything else is blocked and fails the run |
| `runLog.ts` | JSON-lines run log and the Markdown report |

## How to run

Needs a PostgreSQL database with migrations applied. `bash scripts/verify-all.sh` starts a throwaway one and runs this file inside `npm test`. To run it on its own:

```bash
cd Collect-RX-main
DATABASE_URL=<throwaway test database> npx prisma migrate deploy
DATABASE_URL=<throwaway test database> SIM_RUN_DIR=/tmp/crx-sim-runs npx vitest run tests/sim-harness/
```

The report is written to `$SIM_RUN_DIR/<run id>/REPORT.md` (default: the OS temp directory). Never point it at a shared or production database: setup and teardown delete every row that references the synthetic practice, and the run clears the queue engine lease row.

## How to read the result

- The vitest result shows **harness integrity** only: nothing escaped interception and the run completed. It passes even when the product fails.
- The **product verdict** is in `REPORT.md`: every check is PASS, FAIL, UNVERIFIED or FINDING with its evidence. Any FAIL makes the verdict FAIL.

## Safety properties

- Synthetic data only, from `tools/phi-guard/src/synthetic/`.
- No production seam: the hardcoded carrier allowlist in `src/vapi/client.ts` is untouched, so dial payloads still name the real carrier line. The interceptor is the only barrier, and the report says so on every run.
- Teardown deletes every row referencing the run's practice, claims and calls, then scans the whole database for those markers and the synthetic PHI values. Any residue is a FAIL.

## What Stage 1 cannot prove

Pickup timing, hold detection, false pickups, scribe hearing after transfer, and anything said by the live Vapi prompts. Those need Stage 2 (a live mock carrier) and the PRD thresholds.
