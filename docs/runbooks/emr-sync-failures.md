# Runbook: EMR sync outbox delivery failures

**Severity: High.** Covers alert catalog ID `emr_outbox_failures` (`alertCatalog.ts`). Only relevant for practices in `PMS_WRITEBACK` recovery mode — CSV-first practices (the default) don't use this path at all, since they record recovery in CollectRx and wait for the next import rather than writing back to the PMS.

## Detection

- `opsMonitor.ts`'s tick checks `getMetrics()`'s `emrOutbox.failed` vs `emrOutbox.delivered` and fires once `failed >= OPS_ALERT_EMR_MIN_FAILED` (default 3) and `failed > delivered` since process boot.
- Underlying mechanism: `emrSyncOutbox.ts`'s `processEmrSyncOutboxBatch()`, run on each rules-engine tick, POSTs pending rows to `EMR_SYNC_WEBHOOK_URL`. A non-2xx response or network error marks the row failed and resets `processedAt` to `null` for retry next tick.

## Assessment

1. `GET /api/health/metrics` — `emrOutbox.delivered` / `failed` / `devAck` (cumulative since boot; a restart resets these to zero, so a low absolute count doesn't necessarily mean things are healthy — check the *ratio* and recent log lines too).
2. `fly logs -a collect-rx` — grep `[emrOutbox]`. A delivery failure logs the HTTP status and a response-body snippet, or the network error message.
3. Confirm `EMR_SYNC_WEBHOOK_URL` is actually reachable from this process — `assertEmrSyncWebhookUrlAllowed()` validates it's HTTPS and not an internal/private host in production at boot and on each batch; if the URL itself is misconfigured this will reject before ever attempting delivery.
4. Check the practice's `Admin → Sync ops` UI for the specific failed `emr_sync_outbox` rows and their claim IDs — this tells you exactly which claim/payment updates aren't reaching the PMS.
5. If failures are all happening for one practice, the practice's own EMR bridge/webhook receiver is the likely cause, not this service; if it's fleet-wide across every `PMS_WRITEBACK` practice, the shared webhook infrastructure or `EMR_SYNC_WEBHOOK_URL` config is the more likely cause.

## Escalation

- Escalate to whoever owns the practice's EMR bridge integration if the failure is practice-specific and their receiving endpoint is down/erroring — this is often outside CollectRx's own infrastructure.
- Escalate internally if `EMR_SYNC_WEBHOOK_URL` itself is misconfigured or the shared bridge is down for multiple practices.
- Not urgent enough for an immediate page on its own (claims recovery still proceeds correctly inside CollectRx — only the PMS writeback is delayed), but don't let it sit past a business day: the practice's own PMS view will show stale balances until it's fixed, and staff may start manually reconciling in the meantime.

## Mitigation

- **Bad `EMR_SYNC_WEBHOOK_URL` or bridge down:** fix the URL/bridge, then let the next rules-engine tick retry automatically — failed rows have `processedAt` reset to `null` specifically so they're picked up again without manual intervention.
- **No bridge configured but `PMS_WRITEBACK` mode is set:** either configure `EMR_SYNC_WEBHOOK_URL` properly, or move the practice back to CSV-first recovery mode if writeback isn't actually ready yet.
- **Local/dev only:** `EMR_OUTBOX_DEV_ACK=1` marks rows processed without a real HTTP call — never set this in production; if you find it set in production, that's the incident (rows are being marked delivered without ever actually reaching the practice's EMR).

## Verification

1. `GET /api/health/metrics` — `emrOutbox.delivered` climbing, `failed` flat (not climbing further).
2. Confirm in `Admin → Sync ops` that the previously-failed rows now show delivered/processed.
3. Spot-check with the practice (or their PMS support) that a specific claim update actually landed in their system, not just that CollectRx thinks it delivered.

## Postmortem

Required if the backlog grew large enough that staff had to manually reconcile, or if it affected multiple practices. Not required for an isolated single-practice blip that self-resolved on retry — use judgment, but err toward writing a short one if in doubt.
