# Council review: Site reliability and operations lens

Reviewer seat: SRE / operations engineer. Date: 2026-10-13. No code was changed, no calls were placed, nobody was contacted.

Evidence labels: CODE (file and line read), SOURCE (URL and quote), REASONING (premise stated), OPINION. I used no external SOURCE claims; everything below is CODE or REASONING. All paths are under `/home/user/Collect-RX/Collect-RX-main/` unless stated. "Proposal" means `research/2026-10-10-architecture/ARCHITECTURE-PROPOSAL.md`.

## 0. Bottom line

The proposition is operationally sound in direction (one engine, small modules, defects first) and weak in one place: it treats the dispatch consolidation (P1, P10) as the cure for duplicate calls and for scale, when the real fragilities I found in the code are different and are not on the P10 list. Four of them would hurt a second vertical on day one:

1. The slot counter can deadlock the whole fleet and the repair code sits behind it (section 2.1).
2. A carrier block is per tenant and per carrier, not per payer, contrary to what the standing docs say (section 5).
3. The "per-carrier call timeout" table is keyed with the wrong strings and silently falls back to 30 minutes (section 2.3).
4. There is no per-pack, per-payer or per-tenant health signal, and no way to turn off one pack without turning off dispatch (sections 6 and 7).

The intent ledger is real code with no production caller (CODE `src/server/frontDesk/dispatchIntent.ts`; grep of `src/` finds the symbols only in that file). Wiring it up helps with one failure class (ambiguous send) and does nothing for the others.

## 1. Verdict table

| # | Verdict | One-line reason |
|---|---|---|
| P1 | SUPPORT WITH CHANGES | Right shape, but "single dispatch service" must be a code path, not a single process or single point of failure; needs a kill switch per pack and per payer. |
| P2 | SUPPORT WITH CHANGES | Small prompts are good for blast radius; freezing dental_v1 is good; six packs at once is not. Ship one. |
| P3 | SUPPORT | Cheap rule, no operational objection. |
| P4 | SUPPORT WITH CHANGES | Fine, but validation must be at write time and at dispatch time, and a bad attribute must fail one task, not the tick. |
| P5 | SUPPORT WITH CHANGES | "May not change dispatch" is unenforceable as written; needs a per-pack operational contract (kill switch, budget, canary, health). |
| P6 | CANNOT JUDGE | Entity count is not an operational concern. Count of queues and state machines is; none is capped. |
| P7 | OPPOSE as written | An automatic "too few calls" delete is dangerous operationally. Replace with suspend then archive. |
| P8 | SUPPORT WITH CHANGES | Cutting the number pool and per-payer budgets is wrong for the payer dimension; cut the pool, keep a per-payer ceiling. |
| P9 | SUPPORT WITH CHANGES | W1 first is right, but "forces core changes means core is wrong" is a bad test. Forcing a change in how blocks and budgets are keyed is expected. |
| P10 | SUPPORT WITH CHANGES | Correct order, incomplete list. Add the five operational items in section 8 as gates. |
| P11 | SUPPORT | Best control in the proposition. Make it enforced by dispatch code, not by convention. |
| P12 | SUPPORT WITH CHANGES | Good controls, but versioned rollout and rollback of packs is absent, and the golden-transcript gate only covers regressions you thought of. |
| P13 | SUPPORT | Operationally, scope fields also fix the block and noisy-neighbor problems; but see the knowledge write path in section 5. |

## 2. Real failure modes of the current dispatch design

### 2.1 Fleet slot deadlock behind the watchdog (new, high severity)

CODE `src/server/frontDesk/queueEngine.ts:494-527`: the tick counts open attempts fleet-wide (`callAttempt.count({ where: { completedAt: null } })`), computes `slotsRemaining = vapiSlotBudget() - activeCallsGlobal`, and if that is zero or less it defers every practice and returns.

CODE `queueEngine.ts:560-646`: the two repair paths for attempts whose end-of-call webhook never arrived (the stale-attempt watchdog at 3 hours, `STALE_ATTEMPT_MS`, and the over-ceiling terminator at 47 minutes) run only inside the per-practice loop, which starts at line 542, after that early return. They also run after the `isPracticeQueuePaused` return at line 558.

CODE (negative search): `expired_no_webhook` and `ceiling_terminated_no_webhook` are written nowhere outside `queueEngine.ts`.

REASONING: if 8 attempts are open and their webhooks are lost (a webhook outage, a bad deploy, a signature secret rotated wrongly, a Vapi incident), `slotsRemaining` is 0 every tick, the early return fires every tick, and the code that would close those attempts never runs. The fleet stops dialing until a human closes rows by hand. The existing alert `call_attempt_stuck` (CODE `queueHealth.ts:117`, threshold 150 minutes) only pages; it does not heal.

Neither P1 nor P10 mentions this. A due-queue with `SKIP LOCKED` (proposal 15.2) would not fix it either, because the slot count would still be derived from the same open-attempt rows. Fix: the reaper must be its own job, independent of dispatch capacity and of per-practice pause, and slot accounting should come from the vendor's own live-call count with the DB count as a cross-check.

### 2.2 Duplicate calls: what actually protects today and what the ledger adds

Protections that exist:
- Vendor `Idempotency-Key` header = `claimId:attempt` (CODE `queueEngine.ts:964`, `vapi/client.ts:296`). Whether Vapi honors this header and for how long is not shown anywhere in the code. The proposal's section 3.5 treats it as a given. REASONING: unknown retention window means a retry after the 60-minute ambiguous cooldown (CODE `queueEngine.ts:190`) may or may not be deduplicated. This needs a vendor confirmation in writing or a test against the account.
- Single in-process tick latch (`isTickRunning`, line 70) and DB lease (`claimTickLease`, line 267).
- One active attempt per practice (line 658) and `inProgress` count (line 648).
- Manual trigger: row lock `SELECT ... FOR UPDATE` plus attempts re-check (CODE `routes/insurance.ts`, reservation transaction after line 479).

Gaps:
- The lease is claimed once at the start of the tick with a 90 second TTL and is never renewed (CODE lines 241-293, 487). A tick that runs longer than 90 seconds (many practices, each one doing triage and a Vapi call with a 30 second HTTP timeout, per the circuit breaker header and `VAPI_HTTP_TIMEOUT_MS`) lets a second replica start a concurrent tick. Today there is one app machine (CODE `fly.toml`: "deliberately a single-instance, single-region topology, not HA"), so this is latent, but the first time someone scales the app group to 2 for availability, this becomes a double-dispatch window. Both ticks read the same `activeCallsGlobal` snapshot.
- The scheduler loop does not take a per-claim lock (the comment at lines 967-972 says so itself). The only fence between "check for active attempt" and "create attempt" is the single-writer assumption.
- After a successful vendor call, the `CallAttempt` row is created in a separate statement (lines 1019-1030). If the process dies between the vendor response and that insert, there is a live call with no row. The compensating `endVapiCall` runs only if the process is alive to catch the error. A kill (deploy, OOM) in that window leaves an orphan live call that the webhook handler cannot attach to; the slot counter does not see it either, so it also silently exceeds capacity.
- The manual trigger bypasses the slot budget, the per-practice "one call at a time" rule and the fleet carrier concurrency (CODE proposal 3.5A, confirmed in `routes/insurance.ts`: reservation is per claim). A user clicking trigger on three claims of one practice produces three simultaneous calls to the same carrier from one tenant.
- A webhook can create the `CallAttempt` itself on `call.started` (proposal 3.4, `vapiDeskEvents.ts`). That is a third creation path.
- After an ambiguous result the loop `continue`s to the next candidate for the same practice (CODE line 1013), so one ambiguous send can be followed by a second dial in the same tick for the same practice, defeating the "one call per practice per tick" comment at line 1071 and the carrier-concurrency expectation.

What the intent ledger does protect against: a process exit between "decide to send" and "vendor confirmed" (READY then SENDING then CONFIRMED, with `reconcileStaleDispatchIntents` marking SENDING-too-long as AMBIGUOUS and never auto-redialing; CODE `dispatchIntent.ts:104-130`). It also gives staff a visible "held, verify with vendor" state instead of an inferred one.

What it does not protect against:
- The orphan-live-call window above, unless `confirmDispatch` is the only writer of the attempt row AND the reconciler asks the vendor "do you have a call with this idempotency key or this metadata?". Today `reconcileStaleDispatchIntents` never queries the vendor; it can only mark ambiguous. A held AMBIGUOUS intent needs a human to look in the Vapi dashboard (CODE queue deferral text, line 1010). At 10 tenants that is a nuisance; at 200 it is a standing support queue. Add a vendor lookup reconcile.
- Webhook duplicates and out-of-order events (separate ledger, `processed_vapi_webhooks`).
- Anyone who dials by another route (Vapi dashboard, marketing sales squads sharing the same account and webhook, section 16.2 item 7 of the proposal).
- Slot over-commit.
- Concurrent ticks if the lease TTL is exceeded (the intent upsert is keyed by queue entry and attempt number, so it would dedupe the same candidate, but only if the scheduler calls it).
- The CAS-style `where: { id, status: 'READY' }` updates throw on a lost race. Callers must treat that throw as "someone else owns it", not as a failure that defers the claim 15 minutes. Not shown in tests I read; verify.

Also, `recordAmbiguousDispatch` sets the queue entry to BLOCKED with a deferral code, but BLOCKED is also the status `applyCarrierBlock` and `clearCarrierBlock` use (CODE `carrierBlockService.ts:46-52,143-146`). `clearCarrierBlock` flips every BLOCKED queue row for that carrier back to PENDING, which would silently release rows that were BLOCKED for ambiguity. A status that means two different things is a duplicate-call risk the moment both features are live. Use a distinct status or a reason column that the clear path respects.

### 2.3 Timeout table keyed by the wrong strings (new, medium severity)

CODE `billing/tiers.ts:158-166`: `CARRIER_TIMEOUTS` is keyed `'rbc-insurance'`, `'green-shield'`, `'sun-life'`, `'canada-life'`, `'telus-adjudicare'`, `manulife`, `default`. CODE `prisma/schema.prisma:562-568`: `CarrierId` values are `sun_life`, `canada_life`, `manulife`, `green_shield`, `rbc`, `telus_adjudicare`. CODE `vapi/client.ts:44-46`: `maxCallDurationSeconds(carrierId)` looks up `CARRIER_TIMEOUTS[carrierId]` and falls back to `default` (30). Called at `client.ts:404` and `529` with the enum value (I read the signature and the callers' argument names; I did not run it).

REASONING: only `manulife` matches. RBC, documented as "avg 38 min hold, give full ceiling" (45), gets 30, so its calls are cut at the cap before a human answers. The squad config also sets `maxDurationSeconds: 600` on one assistant and 1800 on Hold_Sentinel (CODE `vapi-squad-config.json` lines 40 and 209), so which ceiling wins is unclear. This is a defect with cost impact and with retry impact (a killed hold counts as an attempt, max 3). A new vertical will add payers with hold profiles nobody has measured, and this table is the shape the proposal would copy into `policy_packs`. Make the policy pack keyed by the same identifier as the payer, with a test that every payer has a non-default entry.

### 2.4 Other failure modes in the current design

- Single process doing everything. The queue engine is started inside the API process (CODE `server/index.ts:861`), not in the BullMQ worker. ADR 0002 moves only `RULES_TICK` and `REMINDER_CYCLE` to workers (CODE `docs/adr/0002-background-jobs-bullmq-redis.md`). So "use the existing BullMQ workers" (proposal 15.2 item 1) is a migration of the dispatch loop, not reuse. A deploy of the app restarts the dispatcher; `drainDeskQueueEngine` waits for the in-flight tick with a timeout (CODE lines 139-153), good, but live calls survive the restart and their webhooks arrive at whichever machine is up.
- Tick work is sequential across tenants. Each practice costs several DB queries (pause check, two watchdog scans, in-progress count, active attempt, candidates, plan gate), and a dispatch adds triage and detokenization and a Vapi call. REASONING: with N tenants the tick duration is roughly N times the per-practice query cost plus the dispatch time of up to 8 calls at up to 30 seconds each. I have no measurement; the proposal's own acceptance test (500 synthetic tenants, mock Vapi) is the right measurement and should be run before any second vertical, not after.
- Circuit breaker is global and in memory (CODE `vapi/circuitBreaker.ts`: five consecutive failures open it, 60 second base open, 300 second cap, state per process). It protects the dispatcher from a vendor outage. It does not distinguish a payload-specific 4xx from a vendor-wide failure: `defaultClassifyVapiError` counts 4xx as failures (lines 76-90), so five bad payloads in a row (for example, a new pack with a malformed variable) open the breaker and stop every tenant's dispatch. Blast radius of one bad pack becomes the fleet. 4xx must not feed the breaker, or must feed a separate per-pack breaker.
- Webhook handler does real work inside the HTTP request (lesson extraction, claims validation, transcript persistence, audit enqueue; CODE `webhooks/vapi.ts:556-657`) and returns 5xx on processing failure so Vapi retries (lines 543-554). With a multi-pack system, one pack's post-processing bug (for example, a schema validator that throws) turns into a retry storm against the one endpoint that all tenants and the sales squads share, and into duplicate side effects if only part of the work is idempotent. Post-call work should be enqueued after the ledger claim, with the HTTP response returned fast.
- The human-assisted squad exists only in the Vapi dashboard (proposal 3.4, 16.1) and the dashboard showed a "Publish" control in an unexplained state (16.2 item 3). Rollback of a prompt change there is "click the old version", with no audit trail in the repo.
- Stale attempt watchdog is 3 hours (`STALE_ATTEMPT_MS`), but the maximum call is 45 minutes. A lost webhook holds a slot and the practice's only call lane for up to 3 hours (or until the 47 minute terminator, if `endVapiCall` succeeds). With 8 slots, three lost webhooks is 37 percent of fleet capacity.
- Transcript-based block trigger. `transcriptSignalsCarrierBlock` is a phrase match on a single transcript line and fires `applyCarrierBlock` immediately (CODE `vapiDeskEvents.ts:100-125`, phrases in `carrierBlockPhrases.ts`). A rep who says an ordinary sentence containing a listed phrase blocks that tenant's carrier. See section 5.

## 3. Do P1 and P10 fix the failure modes?

| Failure mode | Fixed by P1/P10? | Note |
|---|---|---|
| Manual vs scheduled divergence (mode, TELUS, COGS, address) | Yes, if the manual path becomes a thin caller of one function | P10 item 1. Good. Insist on a property test over (plan tier, human-assisted flag, trigger type). |
| Intent ledger unused | Yes | But see 2.2: the reconciler must query the vendor, and the BLOCKED status overload must be fixed. |
| Slot deadlock behind watchdog | No | New; section 2.1. |
| Slot over-commit by manual trigger, webhook-created attempts | Partly | Only if "one dispatch path" includes taking a slot (a reservation row) and the webhook-born attempt is removed. |
| Orphan live call after crash post-send | No | Needs vendor reconcile by idempotency key or metadata claim id. |
| Lease TTL shorter than tick | No | Renew the lease per practice or per batch, or take a per-task lock (the due-queue design does this). |
| Timeout table key mismatch | No | Section 2.3. |
| Breaker counts 4xx | No | Section 2.4. |
| Block scope | No | Section 5. |
| Per-pack observability | No | Section 6. |
| Prompt rollout and rollback | No | Section 7. |

P10 is the right order of work but treats "defect fixes" as five items. There are at least five more operational items that gate a second vertical (section 8).

## 4. Is one dispatch service a good idea or a single point of failure?

OPINION, with REASONING: both, depending on what "single" means.

Good: one code path means one place to enforce block, window, plan gate, destination guard, consent, pack kill switch and slot reservation. The divergence defects in proposal 3.5A are exactly what multiple paths produce. Keep it.

Dangerous if "single" means any of these:
- One process with one tick. Today that is true and one slow practice or one slow vendor call delays everyone (the loop is sequential, line 542). A bad task can still hurt the fleet through the breaker (2.4).
- One global lease row (`queue_engine_lease` id `global`, line 240). It is a global mutex for the whole business. A crashed holder blocks dispatch for up to 90 seconds plus the next tick; acceptable. A lease held by a live but wedged tick (the hold is renewed every 60 seconds by the same instance via `locked_by = instanceId`, line 290) blocks forever: `isTickRunning` is true and the latch skips new ticks (line 70-73) with only a warn log. A tick hung on a never-resolving await has no timeout (only the HTTP calls have the 30 second timeout). The only dead-man alert is `queue_dispatch_stalled` after 5 minutes, which pages but does not restart anything.
- One set of settings. A pack-level bug should stop that pack, not dispatch.

Recommended shape, minimal change from the proposal: keep one dispatch function and one set of invariants, but run it as a stateless claim-and-dispatch worker over a due-task queue with per-task locks (the proposal's own 15.2), and put these in front of it, as data the function reads: a global pause flag, a per-pack pause flag, a per-payer-route pause flag, a per-tenant pause flag, and a per-pack and per-payer concurrency ceiling. Single logic, many switches. Two workers must be able to run at once; the acceptance test for that is already in the proposal.

Alternative I would reject: separate dispatchers per vertical. It reintroduces the divergence bugs the proposition is trying to remove.

## 5. Payer "carrier block" propagation across tenants and industries

What the code does:
- `CarrierBlockEvent` rows are keyed by `practiceId` and `carrierId` (CODE `carrierBlockService.ts:28-35`, `adapter.ts:218-239`).
- `checkCarrierBlock` returns blocked if this practice has an open block for the carrier, or if any practice in the same organization does (CODE `adapter.ts:241-284`).
- No other tenant is affected. The standing docs say the opposite: root `CLAUDE.md` says "all calls to that carrier are suspended immediately , not just the current call", and `Collect-RX-main/CLAUDE.md` says the same. With 1 pilot practice the two readings coincide; with 20 tenants calling the same carrier they do not. REASONING: tenant A trips a block, tenants B to T keep dialing the carrier whose security system just flagged automation. That is the failure the rule exists to prevent. The proposal's section 15.2 item 5 recognizes this and proposes tenant-scoped then route-scoped escalation; I agree with the direction and add the following.
- There are two block-handling implementations. `applyCarrierBlock` (transactional, terminates every open Vapi call for that practice and carrier, alerts staff; used by `vapiDeskEvents.ts`, `guardrailAuditWorker.ts`) and `fireCarrierBlockProtocol` (non-transactional `create` then update, sets `recoveryRoute: 'STOP'`, does not terminate other open calls, does not alert; CODE `server/vapi/vapiWebhook.ts:264-297`, called from `processRecoveryCallEnded` at line 431). `clearCarrierBlock` restores claim status and queue status but not `recoveryRoute` (CODE lines 129-156), so claims blocked through the second path come back as IN_QUEUE with `recoveryRoute = STOP`, which the router treats as "do not call". Unify to one function and test the round trip block then clear.
- Block detection quality. The webhook path uses a phrase match on one transcript line (`transcriptSignalsCarrierBlock`) and `processed.carrierBlockDetected` from an outcome classifier. REASONING: with more verticals, more counterpart types (adjusters, body-shop coordinators, TPAs) and more reps saying things like "we do not take calls from automated systems" in a normal refusal, the false positive rate on a phrase list is unknown and untested per vertical. A false positive costs one tenant a block (staff must unblock). A false negative costs the platform's standing with a payer.

Design I recommend (minimal controls, in the order they matter):

1. Keep tenant-scoped immediate block as today (fail closed for the tenant).
2. Add a platform-level, route-scoped "payer advisory" record written automatically when a block fires: `(payer_route, tenant_id, pack, time, evidence_ref)`. Do not pause others on the first one.
3. Escalate to a platform pause on a payer route (pause new dispatch to that route for all tenants, let in-flight calls finish) on either: a second distinct tenant reporting within a window (the proposal's rule; pick a window such as 24 hours as a product decision), or one report whose evidence class is "explicit statement of automation detection" as classified by a human operator within the first minutes, or an operator action. The operator must be paged (see section 6). The pause must auto-expire into a "probation" state, not stay on forever, otherwise a single false positive silently halts a payer for every tenant until someone remembers.
4. Resume is a human action with a reason code, and resumes in probation: one tenant, one call per hour, human-assisted only, until N clean calls.
5. Preventive controls that make blocks less likely when many tenants share a payer: a per-payer-route concurrent call ceiling aggregated across tenants (exists only per `CarrierId`, value 5, CODE `tiers.ts:174-183`, counted from the in-tick snapshot at `queueEngine.ts:512-517`; the manual trigger skips it), a per-payer-route calls-per-hour ceiling, and jitter.
6. Isolation of risk: one tenant's behavior blocking others is a real design tension in both directions. Two tenants cannot both be right about "block all" and "do not let one tenant block others". The route-level pause should take effect only for NEW dispatches and should never cancel another tenant's call already in progress except on an operator action. Tenant-visible messaging must not reveal other tenants' identities or activity ("a payer-route pause is in effect", nothing more).
7. Cross-industry coupling: the same payer (an auto insurer, a property insurer) will be called by rehab, restoration and collision tenants, with different packs and possibly different caller identities. Define the unit of a block as the payer route (payer program, department, phone number), not the payer legal entity, otherwise a block triggered by a restoration adjuster call halts rehab provider-services calls to the same insurer's unrelated line. Define a second, rarer, payer-wide level that only an operator can set.
8. Outbound identity is currently one number for all tenants (proposal 15.1; CODE `vapi/client.ts` `getPhoneNumberId`). Caller ID is the one thing a payer can see that links all tenants. The number pool is cut in P8; I disagree for the payer dimension, see P8.

## 6. Capacity arithmetic from the code defaults

Inputs (CODE): `VAPI_MAX_CONCURRENT_CALLS` default 10, `VAPI_CONCURRENCY_RESERVE` default 2, so the queue may hold 8 simultaneous calls (`queueEngine.ts:206-211`); tick 60 seconds (line 122); one dispatch per practice per tick (line 1071) and one active call per practice (line 658); max call 45 minutes (`tiers.ts:153`), per-carrier 30 minutes by default (but see 2.3), RBC intended 45; call window Mon to Fri 08:00 to 17:00 Eastern (CLAUDE.md, `isWithinCallWindow`), so 9 dispatch hours per day; per-carrier ceiling 5 (`tiers.ts:174`); capacity-exhausted deferral 15 minutes (line 186).

Fleet throughput = slots divided by mean call duration. The only unknown is mean duration, which no one has measured and which the proposal says is unknown (15.5).

| Mean call length | Calls per hour (8 slots) | Calls per 9 hour day | Calls per week |
|---|---|---|---|
| 10 min | 48 | 432 | 2,160 |
| 20 min | 24 | 216 | 1,080 |
| 30 min | 16 | 144 | 720 |
| 45 min (hold heavy) | 10.7 | 96 | 480 |

REASONING on what that means:
- A tenant needs roughly the number of its open claims times average attempts. If a single dental practice has 40 claims in the 30 to 90 day window and the average claim takes about 2 calls, that is 80 calls per cycle per practice. At 20 minute calls, one fleet day is 216 calls, or about 2.7 practices' worth per day of one cycle. This number is illustrative, not measured. The point is that fleet capacity is not a growth-friendly resource: 50 practices of that size need roughly 4,000 calls per cycle, which is about 19 fleet days, before reserve use and before any retry. Raising `VAPI_MAX_CONCURRENT_CALLS` is the real lever, and it is a vendor plan and billing decision (unknown, proposal 16.5).
- One call per practice at a time makes a 20 minute call cap each practice at about 27 calls per 9 hour day regardless of fleet capacity (9 x 60 / 20). A multi-location practice is a different tenant per location in the proposal (each location is a `Practice` row), so a 10-location operator gets 10 lanes. Check that this matches the pricing story.
- Hold-heavy verticals starve adjuster-led ones if they share the slot pool. A claims-line call occupies a slot for tens of minutes; an adjuster call is mostly a voicemail of under 2 minutes. With one flat pool, a dozen long insurer holds can zero out the slots for every voicemail-style task. The fairness ordering (`lastServedAt`, line 305) is per tenant, not per call class or payer, so it does not help. Reserve slots by call class (or by pack), not just a flat reserve of 2.
- Slot exhaustion handling is lossy: when the budget is exhausted, every practice's PENDING rows are pushed forward 15 minutes (`deferForFleetCapacity`, lines 220-235) with `VAPI_CAPACITY_EXHAUSTED`. At steady state under load that is a thundering herd: all deferred rows become due at the same minute, then compete again; the ordering by priority and `scheduledFor` is reset by the identical deferral time. Use jitter (carrier concurrency already has it, lines 192-195) and do not rewrite scheduled times for capacity; leave the rows due and skip.
- The tick itself is serialized (one process, one loop). The time it takes is unmeasured. If the loop takes more than 60 seconds the next fire is skipped with a warn log (line 70-73), so the effective cadence falls without any metric.
- Reserve of 2 is shared by "staff-initiated and pre-visit calls" (comment lines 202-205), but the manual trigger and pre-visit path do not check any slot count (manual trigger CODE above). The reserve is not enforced, only left unused by the queue. The fleet can exceed the Vapi plan limit; the vendor's response (rejection, queueing, or extra charge) is unknown and is a 4xx/5xx the breaker will count.
- Counting: `activeCallsGlobal` counts all open `CallAttempt` rows including human-assisted, the sales squads' calls are not in this table at all (marketing path shares the webhook and the Vapi account, proposal 16.2 item 7). The sales dialer can use up the vendor's concurrency without the claims dispatcher knowing. Count against the vendor, not against your own table.

Acceptance numbers I would require before the second vertical: a measured mean and 95th percentile call length per payer route (from human-assisted calls, which P11 produces), tick duration at 50, 200 and 500 synthetic tenants, and a written decision on the Vapi plan concurrency with a cost per added slot.

## 7. Observability gaps (per pack and per payer)

CODE `server/observability/metrics.ts`: in-process counters (for example `vapiCarrierBlock`, `recordVapiWebhook`), no labels. CODE `alertCatalog.ts`: alerts for tick failing, queue stalled, attempt stuck, circuit open, COGS breaker, worker job failed. CODE `queueHealth.ts` thresholds: stall 5 minutes, stuck attempt 150 minutes.

What is missing, ranked by what would hurt first:

1. No per-payer-route signals: answer rate, hold time distribution, time to human, IVR failure rate, block rate, call-ended-by-vendor rate, mean call length. These are the leading indicators of a payer changing its phone tree or starting to flag callers, which is the incident the platform is most exposed to once many tenants share a payer.
2. No per-pack signals: outcome mix per pack and pack version (including the `unclear` rate, the most important quality proxy in P12), tool-call schema failure rate, post-call fact-check failure rate (the check P12 proposes), staff override rate on outcomes, handoff-to-human rate, disclosure-within-10-seconds pass rate. A bad pack looks like a shift in these long before a complaint.
3. No pack version on the call record. `CallAttempt` has no `objective_pack_version` today (proposal 5.7 adds it as an M4 column); P12 says "each call records pack version, model and settings". Make it a gate: no call dispatches without a pack version snapshot written first. Add the vendor assistant id and squad id and model name seen at dispatch; the live squad can drift because it is edited in a dashboard.
4. Measured hold time is not reliably persisted (proposal 3.4, `ALLOWED_AGENTS` omits Claims_Scribe; hold columns are in a migration but not in the Prisma model). Hold time per payer is the input for capacity planning and for retiring or pricing a module (P7). It is in P10 already; I rank it higher.
5. No tenant-level fairness metric: age of oldest due task per tenant and per pack; share of fleet slots by tenant and by pack. The noisy-neighbor test in the proposal checks it in CI only.
6. No cost per call per pack. The COGS breaker exists per tenant (`tiers.ts:190`), but a pack that doubles call length (a more talkative prompt) changes unit economics for every tenant that enables it.
7. No call-quality canary: nothing continuously places a known-answer test call on a payer route (the TEST squad that simulates RBC's IVR exists in the account, proposal 16.2 item 7; use it for the simulator, not for production routes; guard that test squads cannot be dialed from production routes).
8. No alert on duplicates: two calls with the same tenant and payer route within a short window; two attempts for one task; an attempt without an intent row (after WP-1); an intent AMBIGUOUS older than N minutes; webhook arriving for an unknown vapi call id (orphan call).
9. No alert on stuck slots: open attempts older than the max call length plus grace while slot budget is exhausted (the deadlock in 2.1).
10. The webhook ledger tracks processing, but there is no dashboard for webhook lag, retries, and 503 "processing in progress" counts (CODE `webhooks/vapi.ts:529-533`).

Minimum viable observability: structured log fields on every dispatch and every webhook (tenant, payer route, pack, pack version, intent id, vapi call id, outcome enum), counters and histograms labelled by pack and payer route (never by tenant id in the vendor-facing metrics), and about ten alert rules over those labels. No new infrastructure is needed if logs are structured.

## 8. Rollout and rollback of prompt packs; blast radius of a bad pack

Facts: the human-assisted squad lives only in the Vapi dashboard (proposal 3.4); the repo copy of the autonomous squad may differ from the live one (proposal 3.4, 16.5); prompt changes today are a dashboard edit or a deploy, with no versioned release object. P12 says packs are versioned and that a golden suite gates releases.

What a bad pack can do, from least to most severe:
- Calls fail to connect or loop: wasted minutes and slots for every tenant on that pack.
- Wrong spoken number (the server supplies numbers, P12): money statements to an adjuster that are false. This is the pack failure with legal and commercial consequences.
- Wrong outcome recorded: a task closes or an amount is credited incorrectly. Humans confirm money states (P12), which bounds this.
- Disclosure missing or late: a regulatory exposure (CRTC disclosure within 10 seconds, `Collect-RX-main/CLAUDE.md`). This applies to every pack and every tenant using it, per call. This is the highest blast radius per call.
- Pack leaks identifiers that its field allowlist should have excluded (a prompt that reads out a VIN or an address): a privacy incident, not a quality one.
- Pack causes carrier suspicion: triggers a payer-route block, which stops all tenants on that payer (section 5), including tenants on other packs.
- Pack burns minutes: the breaker (COGS) may throttle the tenants, who see their own service degrade for a fault that is not theirs.

Blast radius of a pack = (tenants enabled) x (calls per day) x (severity). The control is to limit each of those factors by construction.

Rollout design (minimum):
1. Immutable pack versions: a pack version is a content-addressed bundle (prompt fragments, tool schema, outcome schema, model, temperature, voice, timeouts, field allowlist). Dispatch resolves "pack X for tenant T" to a specific version id at dispatch time and writes that id to the intent and to the attempt before sending. Never "latest".
2. Staged exposure: pack version states `draft`, `simulated` (passed golden suite and sim), `canary` (a list of named tenants, human-assisted only, a daily call cap), `general`, `suspended`, `retired`. A version cannot move to `canary` without a recorded golden-suite pass (including the model id used in that pass), and cannot move to `general` without a minimum number of canary calls with a clean quality bar (disclosure pass 100 percent, schema failures under a threshold, `unclear` rate not above a threshold, zero privacy incidents).
3. Fast rollback: a tenant or pack pointer flips to the previous version in one action, no deploy. The previous version's vendor assistant must still exist; do not delete vendor assistants on promote. The squad/assistant sync script (proposal 15.3 item 4) must be idempotent and must write what it deployed to a table so the live account can be diffed against the repo.
4. Kill switches, in increasing scope, all data not code: tenant, pack, pack version, payer route, whole platform. Each respects in-flight calls (finish) and can optionally end them. Each is visible to operators and logged with who and why. The dispatch function checks all of them on every dispatch (a cheap read of a cached flag set with a short TTL).
5. Automatic circuit breaking per pack: if the rolling failure signal for a pack version crosses a threshold (disclosure failure, schema failure, block-detected, abnormal call length), suspend that version automatically and page; do not auto-resume.
6. Model changes are pack changes. P12 says model and prompt changes rerun the suite; also enforce that the vendor cannot silently change a model alias. The shipped squad config pins model names (`claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, CODE `vapi-squad-config.json` lines 12, 191); keep that discipline, and snapshot the model id on every attempt.
7. Golden transcript gate limits: it checks known-failure cases against recorded transcripts. It does not exercise live IVR, hold, voicemail, or counterpart behavior, and it cannot assess a real adjuster's reaction. That is why the canary stage must be human-assisted with a human on the line (P11) and why the test squads must be hard-blocked from production routes.
8. Change windows: do not promote a pack inside the call window of a high-volume day or without an on-call. Promotions on a weekday morning, with someone watching section 7 dashboards for the first hour.

## 9. What retirement (P7) means operationally

P7: "a module with too few calls after a set time is removed". Problems:

- Retirement has many parts, and "removed" is the wrong verb. A module has: tenants who enabled it, open tasks and gates, receivables and cases stored with module attributes (P4), call records, golden suites, vendor assistants and squads, billing entitlements, legal retention obligations for call data and transcripts, and customer-facing promises. Deleting any of it can break historical reporting, reconciliation (`PaymentAllocation` rows reference the receivables), audit and dispute handling. Calls and money records have retention duties I cannot determine; counsel decides.
- "Too few calls" is a confounded metric: it measures sales and onboarding speed, seasonality, a bad import mapper, a bad pack, or a payer outage as much as demand. A module that fails because its pack is bad will show "too few calls" and be removed for the wrong reason. A module in a seasonal industry (restoration after storms, collision in winter) will look dead for months.
- Shared-engine side effects: a retired module leaves orphaned queue rows and in-flight tasks unless a drain is defined.

Operational definition I would adopt:
1. States: `active`, `suspended` (no new dispatch; existing data readable; tenants notified), `read_only` (history only), `archived` (data retained per policy, code path removed). Retirement is a sequence, each step reversible until the last.
2. Trigger is a review with a minimum evidence set (calls attempted, calls reaching a human, outcomes captured, staff-minutes saved estimate, support burden, incident count), not a single count. A tripped threshold opens a review, a human decides.
3. Drain procedure: stop new tasks, let open tasks finish or hand each to staff with a packet, close open gates with a reason code, settle receivable state (no silent "paid"), notify tenants with a date, keep webhooks accepting late events for that module for a grace period (an in-flight call from an old pack can end after suspension).
4. Cost of keeping a module alive should be measured so the threshold means something: on-call load, pack maintenance, golden suite upkeep, payer route monitoring.
5. A retired module's payer routes and knowledge rows must remain correctly scoped so another module does not inherit them.

## 10. Minimum operational controls before any second vertical goes live

This is the list I would make a hard gate (all must exist and be tested; ordered by value per effort):

1. **Reaper independent of capacity** (section 2.1). Closes stale and over-ceiling attempts every minute regardless of slot budget or practice pause; slot count cross-checked with the vendor's own count of live calls. Test: fill the budget with stale attempts and assert dispatch resumes without human action.
2. **One dispatch function, with a slot reservation, used by scheduler, manual trigger, callbacks and any webhook-born path** (P10 item 1, plus slot, per-tenant lane and per-route ceiling enforced on all paths). Intents wired in; `AMBIGUOUS` reconciled against the vendor by key; no attempt row exists without an intent; separate status for ambiguity versus block.
3. **Kill switches and pause flags** at tenant, pack, pack version, payer route and platform scope, read at dispatch, with an operator UI or CLI and an audit log.
4. **Block unification and scope**: one block function; tenant-scoped immediate block; a platform route-level advisory; escalation rule with operator override and automatic probation; round-trip tests (block then clear restores every field). Correct the docs to state what the code does until the new rule ships.
5. **Pack version on the record and immutable pack releases** with `canary` and `suspended` states; pack pointer rollback in one action; all new packs human-assisted for N calls (P11) enforced by dispatch code, not by process.
6. **Per-payer-route concurrency and hourly rate ceilings**, aggregated across tenants, as data in the policy pack, enforced on every path, keyed by the same identifier as the payer record (fixes the timeout table key defect). Do NOT build the full number pool yet, but record the caller number used on every attempt so a pool can be introduced later and so a block can be correlated with the number.
7. **Per-pack and per-payer-route metrics and ten alert rules** (section 7), including duplicates and stuck slots.
8. **Breaker hygiene**: 4xx responses do not open the global breaker; add a per-pack breaker so one pack's bad payload cannot halt other packs.
9. **Webhook post-processing off the request path** and bounded retries, so a bad pack parser cannot create a retry storm against the shared endpoint; test-squad and sales-squad isolation by metadata check on the shared webhook.
10. **Capacity facts recorded**: Vapi concurrency limit and cost per slot, mean and p95 call length per payer route from human-assisted calls, tick duration at 200 and 500 synthetic tenants. Reviewed and written down.
11. **Runbooks** (short, tested): vendor outage, payer block, bad pack, lost webhooks, orphan live call, stuck lease, mass-ambiguous intents, mistaken block by false positive. Each names who is paged and what the first three actions are. There is no on-call design in the material I read; with a second vertical there are more hours of exposure and more kinds of counterpart. Even a founder-only rotation needs a paging path that works at 08:00 Eastern when calls start.
12. **Vendor assurance**: confirmation of `Idempotency-Key` semantics and retention in writing; confirmation of how an account-limit rejection is returned. Without these, the whole duplicate-call story rests on an assumption.

I deliberately leave out: the multi-account vendor strategy, a full number pool, partitioning, a separate dispatcher service, and a data warehouse. They are not required for a second vertical at the volumes a human-assisted launch will produce.

## 11. Per-proposition detail (P1 to P13)

### P1 One shared call engine
Verdict: SUPPORT WITH CHANGES.
Strongest objection: "one engine" will be read as "one switch". The engine as shipped has global state (in-process breaker, one lease, one tick, one slot pool) and a coupling of every tenant to every other tenant through them. Multiple industries sharing it means one pack's fault is everyone's fault unless faults are scoped. (REASONING; CODE sections 2.1, 2.4.)
Evidence: CODE `queueEngine.ts:494-542` (single pool, single loop), `circuitBreaker.ts` (4xx counted), `webhooks/vapi.ts:535-541` (shared endpoint also serves sales calls).
Change my mind: a fault-isolation test matrix in CI: bad pack, bad payer, bad tenant, vendor 4xx, vendor 5xx, lost webhook; each must stay contained to its scope.

### P2 Small prompt per objective; freeze dental_v1
Verdict: SUPPORT WITH CHANGES.
Objection: six packs means six independent release trains and six golden suites, with one on-call. Ship one non-dental pack to canary, not six in parallel. Freezing dental_v1 is the best call in the document; keep the live squad pinned and diff it against the repo copy before freezing, since the live autonomous prompts are unverified (proposal 16.5). (REASONING, OPINION.)
Evidence: proposal 3.4 and 15.3 on the dental prompt size; CODE `vapi-squad-config.json` model pins.
Change my mind: demonstration that pack release (sections 8) is cheap enough that six trains is not a burden.

### P3 Placement test
Verdict: SUPPORT. No operational objection. One addition: operational controls (kill switch, budget, version, metrics) are core regardless of how many modules use them, so the "two consumers" test must not be applied to them. (REASONING.)

### P4 Typed attribute fields
Verdict: SUPPORT WITH CHANGES.
Objection: JSON per-module attributes move errors from migration time to runtime. A task with an attribute that fails validation at dispatch must park that task with a reason, never throw out of the tick (the current loop isolates a practice's failure, line 1076, not a task's). Validate on write and again at dispatch; version the schema with the pack. (REASONING; CODE per-practice catch at `queueEngine.ts:1076-1081`.)
Change my mind: a test showing a poisoned attribute affects exactly one task.

### P5 Module contract
Verdict: SUPPORT WITH CHANGES.
Objection: "may not change dispatch, the vault, or the call engine" cannot be enforced by prose. Operational contract per module should also be a deliverable: kill switch hookup, concurrency ceilings for its payer routes, metrics, runbook entry, golden suite, rollback tested. Missing from the list. (OPINION.)

### P6 Cap of about eight core entities
Verdict: CANNOT JUDGE for operations; the number of tables is not what pages anyone. What I would cap instead: the number of independent state machines that dispatch consults (task state, intent state, queue state, claim state, block state are already five and overlap: queue BLOCKED means two things, section 2.2). (REASONING, CODE `carrierBlockService.ts`, `dispatchIntent.ts`.)

### P7 Retirement rule
Verdict: OPPOSE as written; replace per section 9. Strongest objection: auto-removal on a call-count threshold destroys data and obligations and confuses fault with demand. Change my mind: a defined drain and retention procedure approved by counsel and a human review step.

### P8 Cut list
Verdict: SUPPORT WITH CHANGES.
Disagreement: "per-payer budgets until volume forces them" is wrong because the force is not volume, it is a block. A per-payer concurrency ceiling already exists (5 per `CarrierId`) and is the control that keeps many tenants from looking like one abusive caller (CODE adapter.ts around line 309). Generalize it to payer routes now; it is a policy field and one counter. Agree to cut the full number pool but record the caller number per attempt. Agree with cutting customer-facing QA scoring, but internal QA metrics per pack (section 7) must stay. (REASONING, CODE.)

### P9 W1 first
Verdict: SUPPORT WITH CHANGES.
Objection: W1 reusing the most plumbing is true, and it also sends non-dental tenants to the same six carriers dental tenants use. That is exactly where the shared-payer block risk is highest. It is a risk to dental revenue from a new vertical's behavior, so the route-level ceilings and block rule (section 5) must exist first. And "forces core change means core is wrong" is a bad test: the core needs a payer-route-scoped block and budget and that is a legitimate change, not a shape error. Rephrase: "no module-specific branches in dispatch". (REASONING, OPINION.)

### P10 Build order
Verdict: SUPPORT WITH CHANGES. Correct order; add section 10 items to the "defect fixes" tier, in particular the reaper, the slot reservation on all paths, the timeout key defect and block unification. Also add: confirm Vapi `Idempotency-Key` behavior in writing. Does it fix the failure modes? Partly (section 3 table).

### P11 Human-assisted first, graduate on measured criteria
Verdict: SUPPORT. Strongest part of the proposition operationally: it generates the call-length, hold-time and block-rate data that capacity planning needs. Make it enforced in dispatch (`pack.max_mode` and tenant mode), and make graduation a recorded action with a reviewer. Caveat: the human-assisted flow depends on the staff transfer and on the Scribe still hearing audio after the transfer, which is unverified (proposal 16.2 item 2); until that is tested, the data P11 promises does not exist.

### P12 Hallucination controls
Verdict: SUPPORT WITH CHANGES. Add what the controls do not cover: rollout, canary, suspension and rollback (section 8); drift between the repo and the live account; a runtime monitor of the same signals the post-call check produces, per pack version, with an automatic suspension; vendor model alias pinning. The post-call "each fact appears in the transcript" check is a lagging control: by the time it fires the adjuster has already heard the call. It protects the ledger, not the conversation.

### P13 Scoped shared knowledge
Verdict: SUPPORT. Operational note: shared "known channel" and navigation hints are an input to dispatch (CODE `queueEngine.ts` injects `knownResubmissionChannel`, `carrierIvrInstructions`). A single tenant's mistaken or hostile contribution is a way to harm all tenants; keep the promotion step human and rate-limited, and attach a rollback to knowledge rows the same way as to packs (a bad "IVR hint" is a bad pack).

## 12. Issues the author missed, ranked by severity

1. Slot accounting deadlock: reaper sits behind the early return on exhausted budget (2.1). A webhook outage turns into a full dispatch outage that cannot self-heal. Severity: high.
2. Carrier block is per tenant and organization only, contradicting the stated "all calls to that carrier" rule; two block implementations with different effects; clear does not restore `recoveryRoute` (section 5). Severity: high for a multi-tenant product.
3. Per-carrier timeout table keyed with hyphenated names against underscore enum values, so only one payer gets a non-default ceiling (2.3). Severity: medium, cost and retry impact, and a template for the same bug in `policy_packs`.
4. The shared Vapi account and webhook are used for claims, sales and test squads; the concurrency counter sees only the claims attempts; a test or sales campaign can eat vendor concurrency invisibly (2.4, 6). Severity: medium to high.
5. The global breaker counts 4xx; one bad pack payload can halt the fleet (2.4). Severity: medium.
6. `BLOCKED` queue status is shared between carrier blocks and ambiguous dispatch holds; clearing a block releases ambiguous holds and can redial (2.2). Severity: medium (duplicate calls).
7. Ambiguous send is followed by a possible second dial in the same tick for the same practice (CODE `queueEngine.ts:1013`). Severity: medium.
8. Lease claimed once per tick and not renewed; a tick over 90 seconds permits a concurrent tick on a second replica; a hung tick holds the latch forever with only a log line (section 4). Severity: medium now (single machine), high on the first scale-out.
9. Capacity-exhausted deferral rewrites every pending row to the same time, producing synchronized retries (section 6). Severity: low to medium.
10. Orphan live call window between vendor success and attempt insert (2.2). Severity: medium, rare.
11. The queue engine runs in the API process, not the worker; deploys and web load affect dispatch, and the proposal's "reuse BullMQ" is a migration (2.4). Severity: medium.
12. Webhook handler does heavy post-processing inline and returns 5xx for retry, risking a retry storm from one buggy pack parser (2.4, 7). Severity: medium.
13. Live Vapi configuration is outside version control and was seen in an unexplained unpublished state; rollbacks today are manual dashboard actions (2.4, 8). Severity: medium.
14. Retention and partition plans for growth tables are listed in the proposal (15.2 item 6) but without owners or triggers; a transcript table that grows per call across verticals needs a retention policy before volume, not after. Severity: low to medium.

## 13. Over-engineered and under-engineered parts

Over-engineered for the evidence (OPINION, REASONING):
- Moving all dispatch to a new due-queue with full `recovery_tasks` before any second tenant exists on a vertical. The immediate defects (reaper, one path, slot reservation) can be fixed in the current loop first; the due-queue is warranted by a measurement (tick duration at N tenants), not by a forecast.
- Twenty-plus new tables in migration M1 (Proposal section 9). Ship only what W1 needs. W1 reuses the existing claim row.
- Six packs and a five-module vertical list. Domain research is excerpt-based (proposal section 17 preamble), phone is "the residual path" in most domains (17.1 item 1), and no real call has been observed. One canary module is enough to learn.
- Per-call-profile squads before the vendor's squad limits and override fields are confirmed (proposal 15.3 item 4, 16.3).
- A full attribution classifier before the money states are in use outside dental.

Under-engineered:
- Fault isolation (scoped breakers, scoped flags).
- Reaper and slot accounting.
- Block semantics and false-positive handling.
- Pack release management (versions, canary, rollback, suspension).
- Observability per pack and payer route.
- On-call, runbooks, and alert routing; vendor assurances.
- Retirement procedure.
- Test squads and sales traffic isolation from the production webhook and routes.

## 14. Concrete alternative for the weakest proposition (P7 retirement)

Replace "too few calls after a set time is removed" with a pack lifecycle:

- States: `draft`, `simulated`, `canary`, `general`, `suspended`, `read_only`, `archived`.
- Entry gates between states are data (golden suite pass id, canary call count and quality bar, named approver).
- A scheduled review (monthly) computes, per module: calls attempted, reached-human rate, outcome capture rate, `unclear` rate, staff minutes saved (measured, not estimated), incidents, support tickets, on-call pages, cost per call. If two or more thresholds fail for two consecutive reviews, an operator proposes `suspended`; a person approves.
- `suspended` drains: no new tasks; open tasks go to staff with a packet; tenants are notified; late webhooks still accepted for 30 days.
- `read_only` keeps history queryable. `archived` removes the dispatch code path and the vendor assistants after the retention clock set by counsel.
- Seasonal modules carry a documented expected seasonality so the review compares like with like.

Cost: one status column, one review query, one runbook. No automated deletion.

## 15. What I could not verify

- Whether Vapi honors `Idempotency-Key` on call creation and for how long (not shown in code; vendor question).
- The actual Vapi plan concurrency and what happens above it (unknown to the proposal as well, section 16.5).
- Whether the live autonomous squad matches `vapi-squad-config.json` (proposal 16.5).
- Real average and p95 call lengths (nobody has measured).
- The exact false-positive rate of `transcriptSignalsCarrierBlock` (phrase list not tested against real transcripts; I read the call site, not the full phrase list).
- Whether `maxCallDurationSeconds` receives the enum value at runtime in all callers (I read the lookup and the two call sites' argument names, not a running instance); the mismatch is strong CODE evidence, but a one-line test confirms it.
- Whether any scheduled job outside `src/` calls `reconcileStaleDispatchIntents` (grep of `src/` found none; I did not search deployment scripts).
