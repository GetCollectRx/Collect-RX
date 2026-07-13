# Carrier IVR Discovery and Rediscovery

## Safety model

Carrier IVR discovery is disabled by default. It creates operator work records
and versioned navigation proposals; it does not place calls, register a job,
change carrier policy, or clear `CARRIER_BLOCK`.

Set `COLLECTRX_CARRIER_DISCOVERY_ENABLED=1` only for an authorized, supervised
operator session. Leave it unset in normal API and worker deployments.

## IVR failure relearning

An ended call can contribute an IVR observation only when its transcript has an
explicit navigation failure (for example, an invalid option or menu timeout)
and is **not** a carrier-block event. Extraction is deterministic: only
explicit `Press`, `Dial`, `Say`, `Select`, `Choose`, or `Option` steps survive.
Identifier-like content, names, and free-form transcript text are rejected and
never persisted in discovery records.

Every matching observation creates a normal `PROPOSED` navigation change. It
remains unavailable to dispatch until a separate authorized operator approves
it. Transcript-derived observations never publish a snapshot automatically,
regardless of environment flags or the number of matching observations.

## Anthropic carrier lesson extraction

Carrier lessons are separate from deterministic IVR failure relearning. The
lesson extractor makes a direct Anthropic API request only when both
`ANTHROPIC_API_KEY` is present in the deployment secret manager and
`COLLECTRX_ANTHROPIC_EVAL=1` is explicitly set. It is off by default. Do not
put the key in shell profiles, do not enable this flag in CI, and do not use an
Opus model for this task.

Disabling `COLLECTRX_ANTHROPIC_EVAL` stops future extraction without changing
existing proposed or approved lessons. Existing lessons still follow their
separate human review gate and do not auto-publish IVR snapshots.

### Carrier block distinction

Generic IVR language such as “automated system”, “bot menu”, or “press an
option” is not a block signal. A true carrier action or detection statement
(for example, automation is not permitted, a number is flagged, or bot activity
is detected) follows the existing `CARRIER_BLOCK` protocol immediately.

Relearning never resumes, clears, or overrides a true `CarrierBlockEvent`.
When discovery is enabled, it may add a `CARRIER_ISSUE` work item, but the block
remains active until the existing authorized human unblock process completes.

## Monthly operator sequence

1. A platform admin explicitly enables the environment flag for the session.
2. The admin calls `POST /api/admin/carrier-discovery/roster/monthly` to create
   one monthly work item for every supported carrier.
3. The admin marks a selected item ready with `POST /runs/:id/ready`. This is
   an informational state only; no process consumes it automatically.
4. If an authorized operator performs a permitted carrier check outside this
   application, they must follow the existing weekday 08:00–17:00 Eastern
   window, BAAL/carrier authorization, and CRTC disclosure requirements.
5. The platform admin submits scrubbed navigation steps or a transcript through
   `POST /proposals`. Explicit IVR/menu lines are derived locally from a
   transcript; no LLM or external API is called. Patient, policy, claim,
   date-of-birth, and identifier content is rejected.
6. A platform admin separately approves or rejects the proposal through
   `POST /proposals/:id/review`. Approval creates a new immutable snapshot.

Normal claim dispatch reads only the latest published snapshot. Proposed or
rejected content is never sent to Vapi.

## Carrier issue response

When the existing `CARRIER_BLOCK` path is invoked and the discovery flag is
explicitly enabled, the system records a `CARRIER_ISSUE` rediscovery work item.
It does not resume the block or dial a carrier. The block remains active until
the existing authorized human unblock procedure is completed after investigation.

## Release and rollback

Run `npx prisma migrate deploy` in staging first, review the new snapshot and
proposal rows, then deploy production. Published snapshots are immutable: to
roll back a navigation change, submit and approve a new snapshot containing the
previous safe steps. Do not edit database rows directly and do not clear a
carrier block as part of a navigation rollback.
