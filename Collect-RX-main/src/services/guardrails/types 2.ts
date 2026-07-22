export interface GuardrailRule {
  id: string;
  tier: 'hot-path' | 'audit';
  severity: 'block' | 'escalate' | 'alert';
  description: string;
  delegates_to?: string;
  colang_flow?: string;
}

export interface RuleCatalog {
  version: string;
  rules: GuardrailRule[];
}

export interface Violation {
  rule_id: string;
  severity: 'block' | 'escalate' | 'alert';
  evidence: string;
}

export interface GuardrailDecision {
  allow: boolean;
  escalate: boolean;
  violations: Violation[];
  rulesVersion: string;
}

export interface GuardrailAuditEvent {
  action: string;
  subjectType: string;
  subjectId: string;
  details: Record<string, unknown>;
  rulesVersion: string;
  /** 'system' for cross-practice events (e.g. raw webhook scans before a claim is resolved). */
  practiceId: string;
}

export interface WebhookGuardResult {
  hasPhi: boolean;
  findings: string[];
}

export interface TranscriptPersistResult {
  callAttemptId: string;
  persisted: boolean;
  error?: string;
}

export interface AuditEnqueueResult {
  outboxId: string;
  enqueued: boolean;
  error?: string;
}
