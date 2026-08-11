/**
 * Ops alert definitions — impact + suggested fixes for operators.
 * Used by diagnosis scripts, live smoke, runtime monitor, and CI notifications.
 */

export type AlertSeverity = 'critical' | 'high' | 'medium';

export interface AlertDefinition {
  id: string;
  title: string;
  severity: AlertSeverity;
  /** Plain-language user/business impact */
  impact: string[];
  /** Ordered remediation steps */
  suggestedFixes: string[];
  /** Subsystems affected (for routing to the right on-call skill) */
  affectedSystems: string[];
}

export const ALERT_CATALOG: Record<string, AlertDefinition> = {
  typescript: {
    id: 'typescript',
    title: 'TypeScript compile failure',
    severity: 'high',
    affectedSystems: ['API', 'build', 'deploy'],
    impact: [
      'New deploys may fail or ship broken server code',
      'Developers cannot safely merge until types pass',
    ],
    suggestedFixes: [
      'Run: npm run typecheck',
      'Fix errors shown in the tsc output, then re-run npm run diagnose',
    ],
  },
  env: {
    id: 'env',
    title: 'Environment configuration invalid',
    severity: 'critical',
    affectedSystems: ['API', 'auth', 'webhooks', 'integrations'],
    impact: [
      'Server may refuse to start or reject webhooks in production',
      'Login, Stripe, Vapi, or SendGrid may fail silently or return 401',
    ],
    suggestedFixes: [
      'Run: npm run check:env',
      'Set missing variables with fly secrets set (see ✗ lines)',
      'Compare with Collect-RX-main/.env.example',
    ],
  },
  database: {
    id: 'database',
    title: 'Database schema or connectivity failure',
    severity: 'critical',
    affectedSystems: ['PostgreSQL', 'Prisma', 'all practice data'],
    impact: [
      'Practices cannot log in reliably or see claims/balances',
      'Call queue, reminders, EMR sync, and CDCP workflows are blocked',
      '/api/health/ready will return 503',
    ],
    suggestedFixes: [
      'Confirm Postgres is up (fly postgres list / fly status)',
      'Run: npm run db:migrate',
      'Run: npm run db:verify-tables',
      'Verify DATABASE_URL uses TLS in production (sslmode=require)',
    ],
  },
  tests: {
    id: 'tests',
    title: 'Automated test failures',
    severity: 'high',
    affectedSystems: ['CI', 'regression safety'],
    impact: [
      'A recent change may have broken auth, billing, Canadian expansion, or PHI handling',
      'Deploying without fixing tests risks production regressions',
    ],
    suggestedFixes: [
      'Run: npm test -- --reporter=verbose',
      'See test-results/failures.txt after npm run diagnose',
      'Fix failing tests before merging to main',
    ],
  },
  live: {
    id: 'live',
    title: 'Live API smoke failure',
    severity: 'critical',
    affectedSystems: ['API', 'UI', 'production traffic'],
    impact: [
      'End users may see errors, blank dashboards, or failed logins',
      'Uptime monitors may already be firing',
    ],
    suggestedFixes: [
      'Run: npm run smoke:live',
      'Check fly logs and recent migrations',
      'curl /api/health/ready on the public URL',
    ],
  },
  liveness: {
    id: 'liveness',
    title: 'API process not responding',
    severity: 'critical',
    affectedSystems: ['API', 'all HTTP traffic'],
    impact: [
      'CollectRx is down — browsers and desktop app cannot reach the server',
      'No webhooks (Stripe, Vapi, SendGrid) are being processed',
    ],
    suggestedFixes: [
      'Check fly status -a collect-rx / fly machine restart',
      'Review deploy logs for crash on boot',
      'Verify internal_port and http_service checks in fly.toml',
    ],
  },
  readiness: {
    id: 'readiness',
    title: 'Database not ready',
    severity: 'critical',
    affectedSystems: ['PostgreSQL', 'Prisma'],
    impact: [
      'Load balancers should mark the instance unhealthy',
      'Authenticated routes that need DB will fail',
    ],
    suggestedFixes: [
      'Test: curl $HOST/api/health/ready',
      'Restore Postgres connectivity; run prisma migrate deploy',
      'Check connection pool limits and DATABASE_URL',
    ],
  },
  metrics: {
    id: 'metrics',
    title: 'Health metrics endpoint failure',
    severity: 'medium',
    affectedSystems: ['observability', 'ops dashboards'],
    impact: [
      'Operators cannot see in-process error counters or deployment flags',
      'Does not usually block practices directly',
    ],
    suggestedFixes: [
      'curl /api/health/metrics (add HEALTH_METRICS_TOKEN Bearer in prod)',
      'Check API logs for errors on metrics route',
    ],
  },
  'auth-guard': {
    id: 'auth-guard',
    title: 'API auth guard misconfigured',
    severity: 'high',
    affectedSystems: ['auth', 'insurance API'],
    impact: [
      'Protected claim/queue routes might be exposed without login (security risk)',
      'Or all routes may incorrectly return 500 instead of 401',
    ],
    suggestedFixes: [
      'Verify JWT middleware on /api/insurance/* and /api/work-queue',
      'Run integration test: tests/app.integration.test.ts',
    ],
  },
  database_readiness: {
    id: 'database_readiness',
    title: 'Runtime database check failed',
    severity: 'critical',
    affectedSystems: ['PostgreSQL', 'background jobs'],
    impact: [
      'Server process is up but cannot query Postgres',
      'Rules engine, reminders, and sync will fail on next tick',
    ],
    suggestedFixes: [
      'Check Postgres CPU/connections on host',
      'Restart API after fixing DATABASE_URL',
      'Review Prisma connection errors in logs',
    ],
  },
  high_5xx_rate: {
    id: 'high_5xx_rate',
    title: 'Elevated HTTP 5xx error rate',
    severity: 'high',
    affectedSystems: ['API', 'user requests'],
    impact: [
      'Practices may see intermittent errors in the dashboard or during API calls',
      'Webhook partners may receive retries or failures',
    ],
    suggestedFixes: [
      'Open Sentry (SENTRY_DSN) for stack traces',
      'Check GET /api/health/metrics errors5xx vs requests',
      'Roll back last deploy if spike started after release',
    ],
  },
  ci_failure: {
    id: 'ci_failure',
    title: 'GitHub CI pipeline failed',
    severity: 'high',
    affectedSystems: ['CI', 'deploy safety'],
    impact: [
      'Merges to main may be blocked or unsafe',
      'Production deploy assuming green CI is invalid',
    ],
    suggestedFixes: [
      'Open the failed GitHub Actions run',
      'Run locally: npm run diagnose',
      'Fix failing tests or typecheck before merge',
    ],
  },
  emr_outbox_failures: {
    id: 'emr_outbox_failures',
    title: 'EMR sync outbox delivery failures',
    severity: 'high',
    affectedSystems: ['EMR sync', 'PMS writeback'],
    impact: [
      'Claim/payment updates may not reach the practice EMR',
      'Staff may need manual reconciliation in AbelDent/Dentrix',
    ],
    suggestedFixes: [
      'Verify EMR_SYNC_WEBHOOK_URL is HTTPS and reachable',
      'Check emr_sync_outbox rows with failed status in admin sync UI',
      'Review worker logs: npm run worker',
    ],
  },
  'recovery-practice-attention': {
    id: 'recovery-practice-attention',
    title: 'Recovery items need practice attention',
    severity: 'medium',
    affectedSystems: ['Claims recovery', 'call queue', 'practice gates'],
    impact: [
      'Open practice gates block automated carrier calls until staff completes the step',
      'Payment trace deadlines may pass without a follow-up call',
    ],
    suggestedFixes: [
      'Open CollectRx → Claims → Blocked gates and mark completed items',
      'Check Dashboard “Recovery attention” or the notification bell',
      'Confirm PMS sync if payment verification traces are due',
    ],
  },
  connector_stale: {
    id: 'connector_stale',
    title: 'Desktop connector offline or stale',
    severity: 'high',
    affectedSystems: ['AbelDent sync', 'PMS import', 'work queue'],
    impact: [
      'Claims are not syncing from the practice PMS — queue and calls run on stale data',
      'Staff may need emergency CSV upload under Admin → Sync ops',
    ],
    suggestedFixes: [
      'Confirm CollectRx desktop app is running on the practice PC (tray icon)',
      'Check COLLECTRX_API_TOKEN is set and not revoked (Admin → Sync ops)',
      'Verify ABELDENT_SERVER and SQL connectivity on the practice LAN',
      'Review connector agent row in Admin → Sync ops for last heartbeat',
    ],
  },
  connector_sync_failed: {
    id: 'connector_sync_failed',
    title: 'Desktop connector sync failed',
    severity: 'high',
    affectedSystems: ['AbelDent sync', 'PMS import'],
    impact: [
      'Last sync cycle failed — new claims may not appear in CollectRx',
      'Automated carrier follow-up may miss recently submitted claims',
    ],
    suggestedFixes: [
      'Open Admin → Sync ops → connector status for last error message',
      'On practice PC: check sync worker logs (CollectRx tray → Sync now)',
      'Run abeldent:discover and validate schema-map if SQL errors mention missing columns',
      'Re-mint connector token if auth returns 401',
    ],
  },
  migration_drift: {
    id: 'migration_drift',
    title: 'Database schema behind deployed code',
    severity: 'critical',
    affectedSystems: ['database', 'API', 'call queue', 'webhooks'],
    impact: [
      'The running code ships migrations the database has not applied',
      'Queries against missing tables/columns fail — often silently (empty reads, dropped writes)',
    ],
    suggestedFixes: [
      'Run: npx prisma migrate deploy against the production DATABASE_URL (fly ssh console -a collect-rx -C "npx prisma migrate deploy")',
      'Confirm the deploy pipeline ran the release_command (fly.toml [deploy]) — a skipped or failed release step causes this',
      'If migrations were created locally but never deployed, commit and deploy them',
    ],
  },
  queue_dispatch_stalled: {
    id: 'queue_dispatch_stalled',
    title: 'Call dispatch queue has stopped moving',
    severity: 'critical',
    affectedSystems: ['call queue', 'desk queue engine', 'Vapi dispatch'],
    impact: [
      'Claims that are due to be called are not being dialed even though the call window is open',
      'A practice may go an entire day with zero outbound calls and no one would otherwise notice',
    ],
    suggestedFixes: [
      'Check API process logs for "[deskQueueEngine]" errors around the stall time',
      'Confirm the process is not stuck on isTickRunning (restart the API if a tick has been "running" far longer than 60s)',
      'Check queue_engine_lease table — a stale locked_by row from a crashed replica can block dispatch',
      'curl /api/health/metrics and inspect the queue block for duePendingCount / oldestDuePendingAgeMinutes',
    ],
  },
  call_attempt_stuck: {
    id: 'call_attempt_stuck',
    title: 'Call attempt has been open far longer than any real call',
    severity: 'high',
    affectedSystems: ['call queue', 'Vapi webhook', 'dispatch lock'],
    impact: [
      'The practice this attempt belongs to likely cannot have new calls dispatched until this attempt closes',
      'Usually means the Vapi end-of-call webhook was lost or never arrived',
    ],
    suggestedFixes: [
      'Check Vapi dashboard for the call ID tied to this attempt — confirm it actually ended',
      'Check for webhook delivery failures around the call\'s expected end time',
      'If the call is confirmed over, manually close the CallAttempt row so the dispatch lock releases',
    ],
  },
  worker_job_failed: {
    id: 'worker_job_failed',
    title: 'Background job exhausted all retry attempts',
    severity: 'critical',
    affectedSystems: ['background jobs', 'BullMQ worker', 'rules engine'],
    impact: [
      'A scheduled job (rules tick, credential health check, or similar) did not complete after retrying',
      'Depending on which job, AR follow-up scheduling or credential monitoring may be silently behind',
    ],
    suggestedFixes: [
      'Check worker process logs (npm run worker) for the job name and error in this alert\'s detail',
      'Confirm Redis and Postgres are reachable from the worker process',
      'The job will not run again until its next scheduled repeat — fix the root cause before then',
    ],
  },
  desk_queue_tick_failing: {
    id: 'desk_queue_tick_failing',
    title: 'Desk queue tick has failed repeatedly',
    severity: 'critical',
    affectedSystems: ['call queue', 'desk queue engine', 'Vapi dispatch'],
    impact: [
      'The desk queue tick (runDeskQueueTick) has thrown on 3 or more consecutive runs',
      'While failing, no claims are being evaluated for dispatch — this is worse than a single slow tick',
      'The engine is backing off between attempts, so failures will keep recurring at a slower cadence until fixed',
    ],
    suggestedFixes: [
      'Check API process logs for "[deskQueueEngine] tick error" and this alert\'s detail for the underlying error',
      'Confirm Postgres and Redis (if used) are reachable from the API process',
      'curl /api/health/metrics and check the queue block for lastSuccessfulTickAt / consecutiveTickFailures',
      'Once the underlying cause is fixed, the next successful tick clears this automatically — no manual reset needed',
    ],
  },
  ops_alerting_disabled: {
    id: 'ops_alerting_disabled',
    title: 'Production is running without ongoing ops alerting configured',
    severity: 'critical',
    affectedSystems: ['observability', 'on-call', 'all subsystems'],
    impact: [
      'Queue stalls, database outages, worker failures, and elevated error rates will not page anyone',
      'The only way an incident would be noticed is a practice or client reporting it directly',
    ],
    suggestedFixes: [
      'Set OPS_MONITOR_ENABLED=1 and OPS_ALERTS_ENABLED=1 as host secrets (fly secrets set ...)',
      'Configure at least one delivery channel: ALERT_SMS_TO + Twilio vars, OPS_ALERT_EMAIL_TO + SENDGRID_API_KEY, or OPS_ALERT_WEBHOOK_URL',
      'See docs/operations/OPS-ALERTS.md for the full variable list',
    ],
  },
  vapi_circuit_open: {
    id: 'vapi_circuit_open',
    title: 'Vapi circuit breaker opened — call dispatch paused fleet-wide',
    severity: 'critical',
    affectedSystems: ['Vapi', 'call queue', 'all practices'],
    impact: [
      'No new carrier calls will dispatch for any practice until the breaker closes again',
      'Vapi is failing repeatedly (timeouts, 5xx, or network errors) — this is not a single-claim issue',
    ],
    suggestedFixes: [
      'Check Vapi status page and recent API response codes',
      'curl /api/health/metrics and inspect the vapiCircuitBreaker block for failureReasons and nextProbeEligibleAt',
      'The breaker will self-probe (HALF_OPEN) once its open duration elapses — no manual reset needed unless it keeps re-opening',
      'If Vapi is confirmed healthy but the breaker won’t close, check VAPI_API_KEY/VAPI_SQUAD_ID and recent deploys to src/vapi/client.ts',
    ],
  },
  cogs_breaker: {
    id: 'cogs_breaker',
    title: 'Practice delivery cost breaker tripped — calls paused',
    severity: 'high',
    affectedSystems: ['call queue', 'billing'],
    impact: [
      'Month-to-date call delivery cost crossed the pause threshold for this practice',
      'All automated carrier calls for the practice are paused until the billing cycle resets or an operator resumes them',
    ],
    suggestedFixes: [
      'Review the practice usage: long carrier holds or a claim backlog may be burning minutes',
      'If the spend is legitimate, discuss a tier upgrade with the practice',
      'To resume immediately: clear callsPaused/callsPausedReason on the practice record',
    ],
  },
};

export function getAlertDefinition(alertId: string): AlertDefinition {
  return (
    ALERT_CATALOG[alertId] ?? {
      id: alertId,
      title: `Unknown issue (${alertId})`,
      severity: 'medium',
      affectedSystems: ['unknown'],
      impact: ['CollectRx reported an issue that is not in the alert catalog yet.'],
      suggestedFixes: ['Run npm run diagnose and inspect logs'],
    }
  );
}
