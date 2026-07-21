# CollectRx Engineering Constitution

This document is the authoritative source for engineering principles at CollectRx. It governs how the team makes technical decisions, writes code, designs interfaces, and ships software. When in doubt about an approach, consult this document first.

---

## Part I — Code Quality

### 1. Correctness before cleanliness

A working, slightly verbose solution outranks a elegant but wrong one. Clean up after you've confirmed correctness — never before.

### 2. Minimal diffs

Every change should be as small as possible while fully solving the problem. Do not refactor adjacent code while fixing a bug. Do not add abstractions for future requirements that haven't been specified. Three similar lines of code are better than a premature helper function.

### 3. Names are the primary documentation

Choose names that make intent obvious. A function named `suspendCarrierIfAutomationDetected` needs no comment; one named `handleEvent` needs a comment but shouldn't exist. If you reach for a comment to explain *what* code does, rename instead.

### 4. Comments explain WHY, never WHAT

The only acceptable comment is one that explains a non-obvious constraint, a known external limitation, or a counter-intuitive invariant. Do not write comments that describe what the code literally does. Do not reference the PR, ticket, or caller — those belong in commit messages and rot in code.

### 5. Carrier rules are data, not code

Coverage percentages, deductibles, waiting periods, and annual maxima live in `carrier-configs.json`. Any proposed change that would encode carrier behavior directly in TypeScript must be rejected and converted to a data entry. This rule exists so carrier updates can be deployed without a code release.

### 6. PHI boundary is inviolable

Patient names, DOBs, health card numbers, and any other PHI never leave the backend without tokenization. The Vapi squad sees only UUID tokens. No shortcut, convenience wrapper, or "just for testing" path may bypass this boundary. This is a PHIPA/PIPEDA compliance requirement, not a preference.

### 7. TypeScript strictness

All new code targets `strict: true`. Avoid `any`. Prefer `unknown` over `any` at API boundaries and narrow with type guards. Type assertions (`as X`) require a comment explaining why the cast is provably safe.

### 8. Error surfaces

Errors at system boundaries (incoming HTTP requests, Vapi webhook payloads, CSV imports, Prisma writes) must be caught, logged with context, and returned as typed error responses. Internal code should not defensively catch errors that can't realistically occur — trust the type system and framework guarantees within controlled boundaries.

---

## Part II — Testing Standards

### 9. Tests prove behavior, not coverage

A test that exists only to hit a coverage number is worse than no test. Every test must assert a meaningful behavioral claim: "given X input, the system produces Y output or takes Z action." Coverage is a byproduct of good testing, not the goal.

### 10. Test the claim, not the implementation

Tests must not assert on internal state, private method calls, or implementation details that could change without breaking the external contract. If a refactor breaks tests without changing behavior, the tests were wrong.

### 11. Integration tests over mocks for critical paths

For the claim queue, PHI tokenization, carrier block logic, and Vapi webhook handling — use real database connections and real service calls where possible. Mocked infrastructure has historically masked production failures. Use mocks only when a real dependency is unavailable or prohibitively expensive (e.g., live carrier phone calls).

### 12. Test pyramid ratios

| Layer | Target share | What they cover |
|---|---|---|
| Unit | 50% | Pure functions: eligibility math, CDT mapping, deductible calc, COB logic |
| Integration | 40% | DB round-trips, queue processing, webhook handling, CSV pipeline |
| E2E | 10% | Critical user journeys: claim submission → call scheduled → result recorded |

### 13. New carriers require tests before shipping

When adding a carrier, test cases covering deductible application, annual max tracking, coverage tier calculation, and COB interaction must be committed alongside the `carrier-configs.json` entry. No carrier ships without passing tests.

### 14. Call rules are enforced by tests

The three hard call constraints — no calls outside Mon–Fri 8am–5pm Eastern, max 3 attempts per claim, no calls on claims under 30 days — must each have at least one test that confirms the constraint is enforced. These tests run in CI on every push.

### 15. CARRIER_BLOCK is tested at the scheduling layer

Any code path that schedules a Vapi call must have a test confirming that a set CARRIER_BLOCK flag suppresses the call. This is the highest-priority operational safety test in the suite.

### 16. Test files mirror source structure

A test for `src/server/services/foo.ts` lives at `tests/services/foo.test.ts`. Tests placed in arbitrary locations will not be accepted in review.

---

## Part III — User Experience Consistency

### 17. One surface

There is one frontend: the React/Vite/Tailwind app in `src/`. The old `Collect-RX-main/frontend/` directory was removed. Any work that would introduce a second UI surface requires architectural review and explicit approval. Do not create admin-only pages, internal dashboards, or staging UIs in a separate app.

### 18. Dashboard states are always defined

Every data-fetching view must handle four states explicitly: loading, empty, error, and populated. A component that renders `undefined` or a blank screen instead of a defined empty state is incomplete.

### 19. Monetary values are always in CAD

All dollar amounts displayed in the UI are Canadian dollars. Currency labels must be explicit (`$1,234.56 CAD` or with a visible `CAD` flag). Never display a bare `$` in a context where currency is ambiguous.

### 20. Claim status vocabulary is locked

The set of claim status labels visible to practice staff is fixed:

`Pending` · `In Queue` · `Call Scheduled` · `In Progress` · `Paid` · `Denied` · `Escalated` · `On Hold`

Do not introduce new status strings in UI copy without updating this list and aligning with the Prisma enum. Inconsistent status language erodes trust with dental office staff.

### 21. Destructive actions require confirmation

Any UI action that cannot be undone — removing a claim, pausing a practice, clearing a queue — must show a confirmation dialog that names the specific item being affected. Generic "Are you sure?" prompts are not acceptable.

### 22. Error messages name the problem, not the symptom

"Something went wrong" is not an error message. Error messages must state what failed and, where possible, what the user can do next. Backend error codes must map to human-readable messages before reaching the UI layer.

### 23. Accessibility baseline

All interactive elements are keyboard-navigable. Color is never the sole signal for status (pair it with text or icon). Form inputs have visible labels — placeholders do not substitute for labels.

---

## Part IV — Performance Requirements

### 24. Dashboard load budget

The main dashboard (claim list, queue stats, carrier summary) must load its first meaningful data within **2 seconds** on a standard clinic network connection (50 Mbps, 20ms latency to the Fly.io backend). Page-level loading spinners that persist beyond 2 seconds are a performance regression.

### 25. Queue build is background work

`buildQueue()` and `runQueue()` run as background jobs, not in the request/response cycle. Any API endpoint that triggers queue operations must return immediately (202 Accepted) and process asynchronously. A queue build that blocks an HTTP response for more than 500ms is a bug.

### 26. Claim list pagination

Claim list endpoints must paginate. Default page size is 50. No endpoint may return an unbounded result set regardless of how many claims a practice has.

### 27. Database queries carry indexes

Any query that filters by `practiceId`, `carrierId`, `status`, or `claimDate` must have a covering index. Adding a filter to a query without verifying index coverage is a performance regression. Index migrations accompany schema changes — they are not deferred.

### 28. Vapi webhook handling is under 200ms

Vapi sends webhook events and expects a fast acknowledgment. Webhook handlers must return HTTP 200 within 200ms. Heavy post-call processing (detokenization, DB writes, eligibility reconciliation) is enqueued, not synchronous.

### 29. No N+1 queries

ORM calls inside loops are prohibited. Use `include`, `findMany` with `where in`, or raw SQL joins. N+1 patterns discovered in review are blocking — they compound catastrophically at clinic scale.

### 30. Frontend bundle discipline

The renderer bundle (Vite build) must not exceed 500 KB gzipped for the initial chunk. Large dependencies (chart libraries, date pickers, PDF renderers) must be lazy-loaded. Bundle size is checked in CI.

---

## Part V — Governance

### How principles are applied in practice

**During implementation:** Before starting a non-trivial change, identify which principles are relevant. If the change touches the queue, PHI handling, or carrier logic — that's Parts I, II, and IV minimum. If it touches any UI — that's Part III.

**During code review:** Review comments may cite a principle by number (e.g., "P-11: this should hit a real DB, not a mock"). A principle citation is not a personal criticism — it is a shared reference that avoids relitigating the same decision on every PR.

**When principles conflict:** Correctness (P-1) and the PHI boundary (P-6) are absolute. They override all other principles. If meeting a performance target would require weakening PHI isolation, the performance target is wrong, not the PHI rule.

**When a principle is wrong:** Principles can be updated. The process is:
1. Open a PR against this file with the proposed change and the reason
2. The change must be discussed by at least two engineers before merging
3. The updated principle takes effect on merge, not retroactively

### Decision checklist for new features

Before a new feature is considered ready to implement, verify:

- [ ] Which PHI boundaries does this touch? Is tokenization in scope?
- [ ] Does this interact with the call scheduler or Vapi? Is CARRIER_BLOCK respected?
- [ ] What test cases cover the new behavior (unit + integration)?
- [ ] What are the four UI states (loading, empty, error, populated)?
- [ ] Does this add a DB query? Is it paginated? Are indexes in place?
- [ ] Does this add a webhook handler? Does it return within 200ms?
- [ ] Does this change carrier behavior? Is the change in `carrier-configs.json`, not code?

### Decision checklist for schema changes

- [ ] Migration file committed alongside Prisma schema change
- [ ] Index migration included for any new filterable column
- [ ] Existing queries audited for N+1 risk against the new shape
- [ ] Rollback path documented if the migration is destructive

### What "done" means

A feature is done when:
1. Code passes `npm run lint` and `npm test` with no new skips or `// TODO` markers
2. All four UI states are implemented and manually verified
3. The decision checklist above is complete
4. A team member has reviewed the diff (not just approved it)

A feature is **not** done when tests are pending, the empty/error states are stubbed, or performance hasn't been checked against the budgets in Part IV.

---

*Last updated: 2026-06-19. To propose a change, open a PR against this file.*
