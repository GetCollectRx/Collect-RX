/**
 * Emergency mitigation #2: PII detection and redaction.
 * Ensures no PII appears in logs or error messages.
 *
 * This augments the existing logger.ts redaction with additional safeguards.
 */

// Patterns for common PII
const SSN_PATTERN = /\d{3}-\d{2}-\d{4}/g;
const CANADIAN_PHN_PATTERN = /\d{4}\s\d{4}\s\d{4}/g; // Canadian health card
const PATIENT_NAME_PATTERN = /([A-Z][a-z]+\s+[A-Z][a-z]+)/g; // Capitalized names (aggressive)
const CREDIT_CARD_PATTERN = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g;
const SIN_PATTERN = /\d{3}-\d{3}-\d{3}/g; // Social Insurance Number

export interface PiiRedactionConfig {
  redactSSN?: boolean;
  redactPHN?: boolean;
  redactNames?: boolean;
  redactCreditCards?: boolean;
  redactSIN?: boolean;
  redactEmails?: boolean;
  redactPhones?: boolean;
  redactDates?: boolean;
}

const DEFAULT_CONFIG: PiiRedactionConfig = {
  redactSSN: true,
  redactPHN: true,
  redactNames: false, // Disabled by default to avoid over-redaction of carrier names
  redactCreditCards: true,
  redactSIN: true,
  redactEmails: true,
  redactPhones: true,
  redactDates: true,
};

/**
 * Redact PII from text.
 * Aggressive mode: also redacts capitalized names (may over-redact carrier names, etc).
 */
export function redactPII(
  text: string | unknown,
  config: PiiRedactionConfig = DEFAULT_CONFIG,
  aggressive = false
): string {
  if (!text || typeof text !== 'string') {
    return String(text);
  }

  let result = text;

  if (config.redactSSN) {
    result = result.replace(SSN_PATTERN, 'XXX-XX-XXXX');
  }

  if (config.redactPHN) {
    result = result.replace(CANADIAN_PHN_PATTERN, 'XXXX XXXX XXXX');
  }

  if (config.redactSIN) {
    result = result.replace(SIN_PATTERN, 'XXX-XXX-XXX');
  }

  if (config.redactCreditCards) {
    result = result.replace(CREDIT_CARD_PATTERN, 'XXXX-XXXX-XXXX-XXXX');
  }

  if (config.redactEmails) {
    result = result.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/g, 'XXX@example.com');
  }

  if (config.redactPhones) {
    result = result.replace(
      /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/g,
      'XXX-XXX-XXXX'
    );
  }

  if (config.redactDates) {
    // YYYY-MM-DD format
    result = result.replace(/\d{4}-\d{2}-\d{2}/g, 'XXXX-XX-XX');
  }

  if (aggressive && config.redactNames) {
    // AGGRESSIVE: Redact capitalized names (risky — may over-redact)
    // Only use if field name suggests it's a name
    result = result.replace(PATIENT_NAME_PATTERN, '[REDACTED:NAME]');
  }

  return result;
}

/**
 * Redact PII from an object recursively.
 */
export function redactObject(
  obj: unknown,
  config: PiiRedactionConfig = DEFAULT_CONFIG,
  aggressive = false,
  maxDepth = 10,
  currentDepth = 0
): unknown {
  if (currentDepth > maxDepth) {
    return '[depth exceeded]';
  }

  if (!obj) {
    return obj;
  }

  if (typeof obj === 'string') {
    return redactPII(obj, config, aggressive);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean' || typeof obj === 'symbol') {
    return obj;
  }

  if (obj instanceof Date) {
    return redactPII(obj.toISOString(), config, aggressive);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, config, aggressive, maxDepth, currentDepth + 1));
  }

  if (typeof obj === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Don't redact certain fields that are safe
      if (['id', 'createdAt', 'updatedAt', 'status', 'type', 'reason'].includes(key)) {
        redacted[key] = value;
      } else if (
        ['patientName', 'patient_name', 'subscriberName', 'subscriber_name'].includes(key)
      ) {
        // Known PHI fields — redact completely
        redacted[key] = '[REDACTED:PHI]';
      } else {
        redacted[key] = redactObject(value, config, aggressive, maxDepth, currentDepth + 1);
      }
    }
    return redacted;
  }

  return obj;
}

/**
 * Detect if an object contains PII.
 * Returns true if any PII patterns are found.
 */
export function containsPII(obj: unknown, aggressive = false): boolean {
  const text = JSON.stringify(obj);

  if (SSN_PATTERN.test(text)) return true;
  if (CANADIAN_PHN_PATTERN.test(text)) return true;
  if (SIN_PATTERN.test(text)) return true;
  if (CREDIT_CARD_PATTERN.test(text)) return true;
  if (/@/.test(text)) return true; // Email
  if (/\d{3}-\d{3}-\d{4}/.test(text)) return true; // Phone

  if (aggressive && PATIENT_NAME_PATTERN.test(text)) {
    return true;
  }

  return false;
}

/**
 * List detected PII types in an object.
 */
export function detectPIITypes(obj: unknown): string[] {
  const text = JSON.stringify(obj);
  const types: string[] = [];

  if (SSN_PATTERN.test(text)) types.push('SSN');
  if (CANADIAN_PHN_PATTERN.test(text)) types.push('PHN');
  if (SIN_PATTERN.test(text)) types.push('SIN');
  if (CREDIT_CARD_PATTERN.test(text)) types.push('CreditCard');
  if (/@/.test(text)) types.push('Email');
  if (/\d{3}-\d{3}-\d{4}/.test(text)) types.push('Phone');
  if (PATIENT_NAME_PATTERN.test(text)) types.push('Name');

  return types;
}
