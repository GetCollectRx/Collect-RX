#!/usr/bin/env npx tsx
import 'dotenv/config';
import { alertsFromFailedChecks, dispatchOpsAlert } from '../src/server/observability/opsAlerts.js';

const raw = process.argv[2];
if (!raw) {
  console.error('Usage: dispatch-alert-batch.ts <json-array>');
  process.exit(1);
}

const failed = JSON.parse(raw) as Array<{ id: string; detail?: string; label?: string }>;
const payloads = alertsFromFailedChecks(failed, 'smoke-live');
let sent = 0;
for (const p of payloads) {
  const o = await dispatchOpsAlert(p);
  if (o.sent) sent += 1;
}
process.exit(sent > 0 || !process.env.OPS_ALERTS_ENABLED ? 0 : 1);
