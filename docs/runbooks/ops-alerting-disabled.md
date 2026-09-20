# Runbook: Ops alerting not configured

**Severity: Critical — nothing else will page anyone until this is fixed.** Covers alert catalog ID `ops_alerting_disabled` (`alertCatalog.ts`). This is the one alert that can't rely on the alerting pipe it's reporting on — it rides the separate boot-time startup digest email instead.

## Detection

`checkOpsAlertingConfigured()` (`Collect-RX-main/src/server/observability/startupHealthScan.ts`) runs as part of the startup health scan on every API boot in production and fails this check if `opsMonitorEnabled()` is off, `opsAlertsEnabled()` is off, or no delivery channel (SMS+Twilio, email+SendGrid, or webhook) is configured. Since P1.1, both enablement flags default **on** in production automatically — so if this still fires, either someone explicitly set `OPS_MONITOR_ENABLED=0`/`OPS_ALERTS_ENABLED=0`, or (the more likely case) both are on by default but **no delivery channel is configured at all**, so alerts compute and log but never actually reach anyone.

You'll see this via the startup digest email (`STARTUP_ALERT_EMAIL_TO`, requires `SENDGRID_API_KEY` to even send) — which means if SendGrid itself isn't configured either, **you will not be notified of this by email and must check manually.**

## Assessment

1. Check host secrets: `fly secrets list -a collect-rx` (names only, not values) — confirm which of `OPS_MONITOR_ENABLED`, `OPS_ALERTS_ENABLED`, `ALERT_SMS_TO`+`TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`, `OPS_ALERT_EMAIL_TO`+`SENDGRID_API_KEY`, `OPS_ALERT_WEBHOOK_URL` are actually set.
2. If you can't rely on the digest email having gone out, manually run the startup scan against the live host: `npm run startup-scan` (see `docs/operations/OPS-ALERTS.md`), or check recent boot logs for the `ops_alerting_disabled` check result directly.
3. Confirm this isn't a false alarm from a deliberate `OPS_ALERTS_ENABLED=0` (e.g. during a maintenance window) that was never reverted.

## Escalation

- Treat as critical even though nothing is "broken" in the traditional sense — every other runbook in this directory assumes alerting actually reaches someone. While this is unresolved, **you must rely on manual health checks** (`/api/health/ready`, `/api/health/metrics`, `/api/diagnostics`) on some cadence, because nothing will page you.
- No need to wake anyone up outside business hours purely for this (it's a configuration gap, not an active incident) — but treat it as the first thing to fix once someone is awake, since every minute it's unresolved is a minute where a real incident could go unnoticed.

## Mitigation

1. Set at minimum one delivery channel as a host secret:
   ```
   fly secrets set OPS_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/... -a collect-rx
   ```
   (or the SMS/Twilio or email/SendGrid equivalents — see `docs/operations/OPS-ALERTS.md` for the full variable list).
2. Confirm `OPS_MONITOR_ENABLED`/`OPS_ALERTS_ENABLED` aren't explicitly set to `0` unless that's genuinely intended.
3. Redeploy or restart so the new secrets take effect, then re-check.

## Verification

1. Re-run the startup scan (`npm run startup-scan` or a fresh boot) and confirm `ops_alerting_disabled`'s check now reports `ok: true`.
2. Trigger a real (or deliberately test) alert and confirm it actually arrives on the configured channel — don't just trust the config check; prove delivery end-to-end at least once.

## Postmortem

Required — figure out how alerting ended up unconfigured on a production host in the first place (never set during initial deploy? explicitly disabled and forgotten? secrets lost during a host migration?) and add whatever check would catch this earlier next time (e.g. a deploy-time gate, not just a boot-time digest that itself depends on the same email channel potentially being unconfigured).
