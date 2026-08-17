import { VapiWebhookPayload } from '../../vapi/client';
import { WebhookGuardResult } from './types';
import { writeAuditLog } from './audit';
import rulesJson from './rules.json';

const RULES = rulesJson;

// Patterns that look like PHI: health card numbers, DOBs, names, etc.
const PHI_PATTERNS = [
  /\b\d{10}\b/, // 10-digit HCN (bare)
  /\d{4}-\d{2}-\d{2}/, // DOB format YYYY-MM-DD
  /\d{2}\/\d{2}\/\d{4}/, // DOB format MM/DD/YYYY
  /\d{3,4}-\d{3}-\d{3}/, // HCN with separators (e.g. 1234-567-890)
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}\b/i, // Written DOB (e.g. March 3, 1985)
  /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i, // Reversed DOB (e.g. 3 March 1985)
  /\bDOB\s*:\s*\S+/i, // Any DOB: label
  /\b(?:[A-Z][a-z]+\s+){2,}[A-Z][a-z]+\b/, // Full names (capitalized words - at least 3 parts)
];

function containsPhi(text: string): boolean {
  return PHI_PATTERNS.some((pattern) => pattern.test(text));
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
      practiceId: 'system',
    });
  }

  return { hasPhi, findings };
}

export async function webhookGuardScanPayload(payload: VapiWebhookPayload): Promise<WebhookGuardResult> {
  // High-level check: ensure we're not echoing raw PHI back from the carrier
  const findings: string[] = [];

  // Spot-check summary and transcript for obvious PHI
  const summary = payload.analysis?.summary;
  if (summary && containsPhi(summary)) {
    findings.push('Summary contains PHI-like pattern');
  }

  if (payload.transcript && payload.transcript.length > 0) {
    // Scan the full transcript for PHI patterns (not just first 5 lines)
    const lines = payload.transcript.split('\n');
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
      practiceId: 'system',
    });
  }

  return { hasPhi, findings };
}
