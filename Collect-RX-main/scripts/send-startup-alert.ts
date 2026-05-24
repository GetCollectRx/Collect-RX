#!/usr/bin/env npx tsx
import 'dotenv/config';
import {
  formatStartupDigest,
  type StartupCheckResult,
} from '../src/server/observability/startupHealthScan.js';
import { sendStartupFailureDigest } from '../src/server/observability/startupAlerts.js';

const failures = JSON.parse(process.argv[2] || '[]') as StartupCheckResult[];
const host = process.argv[3] || 'unknown';
const source = process.argv[4] || 'startup-scan';

if (failures.length === 0) process.exit(0);

const { sent } = await sendStartupFailureDigest(failures, { host, source });
if (!sent && !process.env.SENDGRID_API_KEY) {
  const { text } = formatStartupDigest(failures, { host, source });
  console.error('[startup-alert] Configure SENDGRID_API_KEY to email khalid@collectrx.ca');
  console.error(text);
  process.exit(1);
}
process.exit(0);
