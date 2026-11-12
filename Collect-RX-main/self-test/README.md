# Application self-test

A contained, repeatable test of the CollectRx application itself: the web app, the API, the queue and the Vapi webhook, played as synthetic dental offices. No one has to sit in front of it and nothing leaves the machine.

```bash
npm ci
npx playwright install chromium
bash self-test/run.sh
```

It takes about a minute and writes `self-test/report/SELF-TEST-REPORT.md`. The exit code is non-zero only when a contract fails.

## The crawl

`bash self-test/run.sh crawl` takes about 15 minutes and writes `self-test/report/CRAWL-REPORT.md` with screenshots. It signs in as every reachable role (owner, office manager, billing coordinator, front desk, accountant, group admin, and an anonymous visitor), visits every route each role should and should not reach, clicks every safe button on every page the office manager can reach, and requests every static API path the frontend calls with no login. Each page is scored WORKS, PARTLY or BROKEN. Platform admin pages are untested because that role cannot be created through the product.

## What it does

1. Starts a throwaway PostgreSQL 16 (or uses `SELFTEST_DATABASE_URL`, whose database name must contain `test` or `verify`).
2. Starts a fake Vapi that records every call the app would have placed.
3. Starts the real app server in an allowlisted environment (`env -i`, so no inherited API key reaches it) with an egress guard preloaded.
4. Drives the real app: a new office signs up in the browser, an owner invites an office manager, CSV import in the browser, setup, a dial, the webhook coming back, a carrier refusal, a second office, hostile data, every main page.
5. Fails if the app tried to reach any non-loopback host or the browser tried to resolve one.

## Containment, layer by layer

| Layer | What stops a leak |
|---|---|
| Environment | `env -i`: the app only sees variables listed in `run.sh`. Every third-party key is absent. |
| Network, app | `egressGuard.cjs` refuses and logs any connection, DNS lookup or fetch to a non-loopback host. It has its own test (`tests/selfTestEgressGuard.test.ts`). |
| Network, browser | Chromium runs with a host-resolver rule that fails every host except loopback. |
| Vapi | `VAPI_BASE_URL` points at the fake. Every Vapi call in the app reads it through `src/vapi/baseUrl.ts`. |
| Data | Everything is synthetic. The PHI boundary is checked on the real dial path: no name, DOB or member id may appear outside the ephemeral call variables. |
| Database | Never touches an existing database: it is created fresh, or its name must contain `test` or `verify`. |

## Reading the report

* **PASS** a check held.
* **FAIL** a contract broke (PHI boundary, tenancy, a double dial, webhook authentication, containment). The run fails.
* **FINDING** something to know about that is not a hard contract: a missing UI message, a known gap. It does not fail the run.
* **UNVERIFIED** it cannot be checked inside the containment, and the report says why.

## Limits, stated plainly

* It cannot place or receive a real phone call, so voice behaviour is covered by the Carrier Twin (`tests/sim-harness/stage2`), not here.
* A successful staff transfer needs an https `vapi.ai` control URL, which the app correctly refuses to send commands to anywhere else. That path is UNVERIFIED here.
* The real email, billing, and carrier-portal integrations are off. What the app does when they are unconfigured is tested; what they do when configured is not.
* The frontend is exercised through its real pages, but visual layout and accessibility are not judged beyond "renders without an error".
* Chromium is the only browser tested, and the crawl judges whether a page loads, not whether its numbers are right.
* It has been run on Linux and, for `run.sh`, on a Mac. The embedded-database path (no `SELFTEST_DATABASE_URL`) is the one you will use on a Mac and has not been run here.

## Adding a journey

Add a `test(...)` to `selftest.spec.ts`. Use `rec.expect(..., true)` for something that must always hold and `rec.observe` for something you only want visibility on. Run `npm run self-test:typecheck` after editing.
