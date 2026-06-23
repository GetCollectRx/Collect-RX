import { describe, expect, it } from 'vitest';
import { buildSimpleReportPdf } from '../src/server/lib/simpleReportPdf.js';

describe('buildSimpleReportPdf', () => {
  it('returns a valid PDF header', () => {
    const buf = buildSimpleReportPdf('Test Report', [
      ['Col A', 'Col B'],
      ['1', '2'],
    ]);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.toString('utf8')).toContain('%%EOF');
  });
});
