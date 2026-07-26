import { describe, expect, it } from 'vitest';
import {
  parsePreVisitStructuredData,
  preVisitStructuredDataSchema,
} from '../../src/server/preVisit/preVisitStructuredOutput.js';

describe('parsePreVisitStructuredData', () => {
  it('parses approved predet payload from fixtures', () => {
    const parsed = parsePreVisitStructuredData({
      predetermination_status: 'approved',
      eligibility_status: 'eligible',
      outcome: 'APPROVED',
    });
    expect(parsed.valid).toBe(true);
    expect(parsed.predetStatus).toBe('approved');
    expect(parsed.eligibilityStatus).toBe('eligible');
  });

  it('parses denied payload with denial code', () => {
    const parsed = parsePreVisitStructuredData({
      predetermination_status: 'denied',
      reason_code: 'F-010',
      denial_reason_text: 'Missing radiograph',
    });
    expect(parsed.denialCode).toBe('F-010');
    expect(parsed.denialText).toBe('Missing radiograph');
  });

  it('rejects invalid predetermination status', () => {
    const result = preVisitStructuredDataSchema.safeParse({
      predetermination_status: 'maybe',
    });
    expect(result.success).toBe(false);
  });
});
