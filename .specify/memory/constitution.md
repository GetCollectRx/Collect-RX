# CollectRx Constitution

## Core Principles

### I. Correctness & PHI Inviolability

Every feature starts from correct behavior. PHI (patient names, DOBs, health card numbers) MUST never cross to Vapi or any external service without tokenization. The backend tokenizes all identifiers before any outbound call; the Vapi squad operates on UUID tokens only; detokenization happens on the backend after call completion. This rule has no exceptions and supersedes all other principles when in conflict. Violating it breaks PHIPA/PIPEDA compliance.

### II. Carrier Rules Are Data, Not Code

Coverage percentages, deductibles, waiting periods, and annual maxima MUST live in `carrier-configs.json`. Any change that encodes carrier behavior directly in TypeScript is a violation. This rule exists so carrier updates can be deployed without a code release. Principle applies to all six supported carriers: Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare.

### III. CARRIER_BLOCK Is Always Respected

If a carrier detects automation, all calls to that carrier MUST be suspended immediately — not just the current call. Any code path that schedules a Vapi call MUST check the CARRIER_BLOCK flag before proceeding. This is the highest-priority operational safety rule. Any test suite touching the call scheduler MUST include a test confirming CARRIER_BLOCK suppresses calls.

### IV. Testing Standards (Integration Over Mocks for Critical Paths)

For the claim queue, PHI tokenization, carrier block logic, and Vapi webhook handling, tests MUST use real database connections. Mocked infrastructure has historically masked production failures. Unit tests (pure functions: eligibility math, CDT mapping, deductible calc, COB) may use mocks freely. Target ratio: 50% unit / 40% integration / 10% E2E. The three hard call constraints — no calls outside Mon–Fri 8am–5pm Eastern, max 3 attempts per claim, no calls on claims under 30 days old — MUST each have at least one dedicated test.

### V. Performance & Minimal Footprint

Dashboard load MUST be under 2 seconds. Vapi webhook handlers MUST return HTTP 200 within 200ms; post-call processing is always enqueued, never synchronous. Claim list endpoints MUST paginate (default page size 50). No endpoint may return an unbounded result set. The renderer bundle MUST not exceed 500 KB gzipped for the initial chunk. N+1 queries are prohibited — ORM calls inside loops are a blocking code review finding.

### VI. One Surface, Four UI States

There is one frontend: the React/Vite/Tailwind app. Every data-fetching view MUST handle four states explicitly: loading, empty, error, and populated. Claim status vocabulary is locked to: `Pending`, `In Queue`, `Call Scheduled`, `In Progress`, `Paid`, `Denied`, `Escalated`, `On Hold`. All monetary values displayed are Canadian dollars with explicit CAD labels. Destructive UI actions require a named confirmation dialog.

### VII. Minimal Diffs & No Premature Abstraction

Changes MUST be as small as possible while fully solving the stated problem. Refactoring adjacent code during a bug fix is prohibited. Three similar lines are better than a premature helper function. Features are not designed for hypothetical future requirements not in the current spec.

## Call Safety Rules

These are operational constraints that MUST be enforced in code and tested:

- Calls only Mon–Fri 8am–5pm Eastern time
- Maximum 3 call attempts per claim
- Claims under 30 days old: do not enter queue
- Claims over 90 days old: skip AI, escalate to human immediately
- TELUS AdjudiCare minimum claim wait is day 21 (all other carriers: day 32)

## Governance

**Constitution supersedes all other practices.** When a principle conflicts with a shortcut, deadline pressure, or a "just this once" exception, the principle wins.

**Amendment process**: Open a PR against `.specify/memory/constitution.md`. The change requires discussion by at least two engineers before merging. The updated principle takes effect on merge, not retroactively.

**Constitution check in planning**: Before implementation of any feature touching the call scheduler, Vapi webhooks, or PHI handling, the plan MUST include an explicit Constitution Check section verifying compliance with Principles I, III, and IV.

**Definition of done**: A feature is done when (a) `npm run lint` and `npm test` pass with no new skips, (b) all four UI states are implemented and verified, (c) the call safety rules are enforced and tested if applicable, and (d) a team member has reviewed the diff.

**Version**: 1.0.0 | **Ratified**: 2026-06-19 | **Last Amended**: 2026-06-19
