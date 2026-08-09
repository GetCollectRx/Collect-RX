import { VapiWebhookPayload } from '../../vapi/client';
import { WebhookGuardResult } from './types';
import { writeAuditLog } from './audit';
import rulesJson from './rules.json';

const RULES = rulesJson;

const MONTH_NAMES =
  'January|February|March|April|May|June|July|August|September|October|November|December|' +
  'Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

// Patterns that look like PHI: health card numbers, DOBs, names, etc. This is a
// best-effort safety net behind the real PHI boundary (metadata = UUID token only,
// see docs/compliance/PHI-VAPI-BOUNDARY.md) — it exists to catch a leak if that
// boundary is ever violated by an unaudited code path, not to be the primary control.
const PHI_PATTERNS = [
  /\b\d{10}\b/, // 10-digit HCN, unbroken
  /\b\d{4}[- ]\d{3}[- ]\d{3}\b/, // HCN with separators, e.g. 1234-567-890 / 1234 567 890
  /\d{4}-\d{2}-\d{2}/, // DOB format YYYY-MM-DD
  /\d{2}\/\d{2}\/\d{4}/, // DOB format MM/DD/YYYY
  new RegExp(`\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'i'), // "March 3, 1985"
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_NAMES})\\.?,?\\s+\\d{4}\\b`, 'i'), // "3 March 1985"
  /\b(?:[Pp]atient|[Nn]ame)(?:'s)?\s+(?:is|was)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/, // "Patient is Jane Elizabeth Doe"
  /\bDOB[:\s]+[A-Za-z0-9,./ -]{6,20}/i, // any "DOB: ..." label — content shape doesn't matter, the label itself is the leak
  /\bhealth\s*card\s*(?:number|#|no\.?)?[:\s]+[A-Za-z0-9 -]{4,20}/i,
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
    // Scan every line — a 5-line sample let PHI beyond the opening of a call through
    // unchecked, and this is the only place that ever actually looks at the transcript.
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
