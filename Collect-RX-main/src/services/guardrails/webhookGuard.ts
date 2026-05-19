import { VapiWebhookPayload } from '../../../vapi/client';
import { WebhookGuardResult } from './types';
import { writeAuditLog } from './audit';
import rulesJson from './rules.json';

const RULES = rulesJson;

// Patterns that look like PHI: health card numbers, DOBs, etc.
const PHI_PATTERNS = [
  /\b\d{10}\b/, // 10-digit HCN
  /\d{4}-\d{2}-\d{2}/, // DOB format YYYY-MM-DD
  /\d{2}\/\d{2}\/\d{4}/, // DOB format MM/DD/YYYY
];

function containsPhi(text: string): boolean {
  return PHI_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeForLog(obj: unknown, depth = 0): string {
  if (depth > 2) return '[...]';
  if (typeof obj === 'string') {
    if (obj.length > 100) return obj.substring(0, 100) + '...';
    return obj;
  }
  if (typeof obj === 'object' && obj !== null) {
    return JSON.stringify(obj, null, 2).substring(0, 200);
  }
  return String(obj);
}

export async function webhookGuardScanMetadata(payload: VapiWebhookPayload): Promise<WebhookGuardResult> {
  const findings: string[] = [];

  const metadata = payload.metadata || {};

  // Scan metadata object for PHI patterns
  Object.entries(metadata).forEach(([key, value]) => {
    if (typeof value === 'string' && containsPhi(value)) {
      findings.push(`Metadata.${key} contains PHI pattern: "${value.substring(0, 20)}..."`);
    }
  });

  const hasPhi = findings.length > 0;

  if (hasPhi) {
    await writeAuditLog({
      action: 'GUARDRAIL_WEBHOOK_PHI_DETECTED',
      subjectType: 'VapiWebhook',
      subjectId: payload.call?.id || 'unknown',
      details: {
        findings,
        metadataKeys: Object.keys(metadata),
      },
      rulesVersion: RULES.version,
    });
  }

  return { hasPhi, findings };
}

export async function webhookGuardScanPayload(payload: VapiWebhookPayload): Promise<WebhookGuardResult> {
  // High-level check: ensure we're not echoing raw PHI back from the carrier
  const findings: string[] = [];

  // Spot-check summary and transcript for obvious PHI
  if (payload.summary && containsPhi(payload.summary)) {
    findings.push('Summary contains PHI-like pattern');
  }

  if (payload.transcript && payload.transcript.length > 0) {
    // We'll audit the full transcript post-call; just flag obvious patterns here
    const lines = payload.transcript.split('\n').slice(0, 5); // Sample first 5 lines
    lines.forEach((line, idx) => {
      if (containsPhi(line)) {
        findings.push(`Transcript line ${idx} contains PHI-like pattern`);
      }
    });
  }

  const hasPhi = findings.length > 0;

  if (hasPhi) {
    await writeAuditLog({
      action: 'GUARDRAIL_WEBHOOK_PAYLOAD_ALERT',
      subjectType: 'VapiWebhook',
      subjectId: payload.call?.id || 'unknown',
      details: { findings },
      rulesVersion: RULES.version,
    });
  }

  return { hasPhi, findings };
}
