# Runbook: Carrier block detected

**Severity: Critical.** Per `Collect-RX-main/CLAUDE.md`: "If a carrier detects automation, all calls to that carrier are suspended immediately — not just the current call. This is the most critical operational safety rule." This runbook is about confirming the automated suspension worked correctly and deciding when it's safe to resume — not about overriding it.

## Detection

You'll be paged directly, not through the general ops-alert catalog: `sendCarrierBlockAlert()` (`Collect-RX-main/src/services/alerts.ts`) sends its own SMS + email the moment a block is applied — separate from `dispatchOpsAlert`/`alertCatalog.ts`. Subject line: **"🚨 CARRIER BLOCK DETECTED — CollectRx"**, with carrier name, practice ID, the triggering Vapi call ID, and a direct unblock link.

A block can be triggered from three places (`applyCarrierBlock()` in `carrierBlockService.ts`, called from):
- `vapiDeskEvents.ts` — a live transcript matches a known block phrase (`carrierBlockPhrases.ts`'s baseline list + any self-tuner-learned phrases).
- `vapiDeskEvents.ts` — the end-of-call webhook payload itself flags `carrierBlockDetected`.
- `guardrailAuditWorker.ts` — a background guardrail audit independently flags the call.

## Assessment

1. Confirm the block is real and see current state:
   ```
   GET /api/carriers/health?practiceId=<id>
   ```
   Look for the affected carrier's `isBlocked: true` and `blockedSince`.
2. Read the transcript excerpt in the alert email/SMS and in `CallTranscriptLine` rows for the call — was the block phrase a genuine carrier automation-detection statement, or a false positive (e.g. the carrier rep said something superficially similar but wasn't actually rejecting the call)? Cross-check against `getActiveBlockPhrases()`'s baseline in `carrierBlockPhrases.ts` — if a *learned* phrase (added by the self-tuner, not the hardcoded baseline) caused a false-positive block, that phrase is now a liability and needs review, not just this one incident.
3. Check blast radius — `applyCarrierBlock()` sets **every** `PENDING`/`IN_PROGRESS` queue entry and `PENDING`/`IN_QUEUE`/`CALLING` claim for that carrier+practice to `BLOCKED`, and hangs every other open Vapi call to that carrier for that practice. Confirm via:
   ```
   GET /api/carriers/health?practiceId=<id>
   ```
   and the practice's Claims view filtered to the blocked carrier.
4. If `isCarrierDiscoveryEnabled()` is on (`discovery/carrierDiscoveryService.ts`), a `requestCarrierRediscovery()` may already be queued — check `Admin → Carrier discovery` (or the underlying discovery-request table) before manually re-investigating IVR navigation for this carrier.

## Escalation

- **Do not attempt to resume calls to this carrier without human confirmation that the block is resolved.** This is not a judgment call to make alone under time pressure — if you're unsure whether the transcript genuinely shows detection, treat it as a real block and escalate rather than guessing.
- If the same carrier has blocked **multiple practices** in a short window, or the same practice has been blocked by **multiple carriers**, treat it as a systemic IVR-navigation or disclosure-script regression (check recent deploys to `src/vapi/client.ts`, the squad config, or the CRTC disclosure script — `Collect-RX-main/docs/compliance/crtc-disclosure-decision.md`) rather than one-off carrier behavior. Escalate to whoever owns the Vapi squad config immediately; do not clear individual blocks while the root cause is still active, or they will just re-trigger.
- If a *false positive* is suspected from a **self-tuner-learned** block phrase, escalate to whoever owns the self-tuning pipeline (`src/server/learning/selfTuner/`) — the phrase needs to be reviewed and possibly rolled back from `learned-rules/block-phrases.json`, not just this block cleared.

## Mitigation

Carrier blocks do **not** auto-clear — they require an explicit human decision. Once you've confirmed it's safe:

```
POST /api/carriers/:carrierId/unblock
Body: { "resumedBy": "<your name/id>", "notes": "<why you're confident this is resolved>" }
```

This resolves all active `CarrierBlockEvent` rows for the practice+carrier, moves `BLOCKED` queue entries back to `PENDING`, and moves `BLOCKED` claims back to `IN_QUEUE`. It does **not** retroactively fix whatever caused the block — if the root cause was a script/navigation regression, that needs its own fix deployed first, or the very next call will re-trigger the block.

If the root cause needs more time to fix than the practice can wait, leave the block in place and communicate directly with the practice about the delay — don't unblock just to stop the queue from looking stalled.

## Verification

1. `GET /api/carriers/health?practiceId=<id>` — confirm `isBlocked: false` for the carrier.
2. Watch the next scheduled call to that carrier for that practice through `Console`/live desk view — confirm it navigates the IVR and reaches a rep without re-triggering the block phrase detector.
3. If the fix was a squad-config or navigation change, verify against at least 2–3 successful calls before considering it resolved — one clean call could be coincidence (e.g. hit a different IVR menu path).

## Postmortem

Required for every carrier block, even a confirmed false positive — see `POSTMORTEM-TEMPLATE.md`. A false-positive block phrase reaching production, however it got there, is itself worth a root-cause writeup: how did it get learned/added, and what would have caught it before it fired on a real call.
