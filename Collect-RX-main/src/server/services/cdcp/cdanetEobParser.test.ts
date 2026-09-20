import { describe, expect, it } from 'vitest';
import { parseEOB, buildPredeterminationPayload } from './cdanetEobParser.js';
import type { PreSubmissionAuditResult } from './preSubmissionAudit.js';

function readyAudit(cdtCode: string): PreSubmissionAuditResult {
  return {
    claimId: 'CLM-1',
    cdtCode,
    procedureSection: 'general',
    requiredEvidence: [],
    missingEvidence: [],
    readyToSubmit: true,
    blockingIssues: [],
  };
}

function blockedAudit(cdtCode: string, issue: string): PreSubmissionAuditResult {
  return {
    claimId: 'CLM-1',
    cdtCode,
    procedureSection: '6.3.5.2',
    requiredEvidence: [],
    missingEvidence: [],
    readyToSubmit: false,
    blockingIssues: [issue],
  };
}

describe('parseEOB', () => {
  it('sums approved/unpaid amounts across line items and collects rejection reasons', () => {
    const xml = `
      <CDAnetMessage>
        <Header><TransactionId>TX-123</TransactionId></Header>
        <Response>
          <AdjudicationStatus>00</AdjudicationStatus>
          <TreatmentLineItems>
            <LineItem>
              <SubmittedAmount>150.00</SubmittedAmount>
              <ApprovedAmount>150.00</ApprovedAmount>
            </LineItem>
            <LineItem>
              <SubmittedAmount>800.00</SubmittedAmount>
              <ApprovedAmount>600.00</ApprovedAmount>
              <RejectionReasonCode>F-011</RejectionReasonCode>
            </LineItem>
          </TreatmentLineItems>
        </Response>
      </CDAnetMessage>`;

    const result = parseEOB(xml);
    expect(result.transactionId).toBe('TX-123');
    expect(result.responseCode).toBe('00');
    expect(result.approvedAmountInCents).toBe(75_000);
    expect(result.unpaidAmountInCents).toBe(20_000);
    expect(result.rejectionReasons).toEqual(['F-011']);
  });

  it('defaults to a single line item when only one LineItem element is present (no array)', () => {
    const xml = `
      <CDAnetMessage>
        <Header><TransactionId>TX-456</TransactionId></Header>
        <Response>
          <AdjudicationStatus>52</AdjudicationStatus>
          <TreatmentLineItems>
            <LineItem>
              <SubmittedAmount>100.00</SubmittedAmount>
              <ApprovedAmount>0</ApprovedAmount>
              <RejectionReasonCode>F-010</RejectionReasonCode>
            </LineItem>
          </TreatmentLineItems>
        </Response>
      </CDAnetMessage>`;

    const result = parseEOB(xml);
    expect(result.approvedAmountInCents).toBe(0);
    expect(result.unpaidAmountInCents).toBe(10_000);
    expect(result.rejectionReasons).toEqual(['F-010']);
  });

  it('throws on a structurally invalid message', () => {
    expect(() => parseEOB('<NotCDAnet/>')).toThrow(/Invalid CDAnet Version 4 XML structure/);
  });
});

describe('buildPredeterminationPayload', () => {
  it('refuses to package when any line item failed its pre-submission audit', () => {
    const result = buildPredeterminationPayload('CLM-1', 'practice-1', '123456789', [
      { cdtCode: 'D2740', feeInCents: 90_000, audit: blockedAudit('D2740', 'Missing: bone-level radiograph') },
    ]);

    expect(result.ok).toBe(false);
    expect(result.xml).toBeUndefined();
    expect(result.blockedLineItems).toEqual([
      { cdtCode: 'D2740', blockingIssues: ['Missing: bone-level radiograph'] },
    ]);
  });

  it('packages a valid Version 4 XML payload once every line item is audit-clean', () => {
    const result = buildPredeterminationPayload('CLM-2', 'practice-1', '123456789', [
      { cdtCode: 'D1110', feeInCents: 15_000, audit: readyAudit('D1110') },
    ]);

    expect(result.ok).toBe(true);
    expect(result.blockedLineItems).toEqual([]);
    expect(result.xml).toContain('<TransactionId>CLM-2</TransactionId>');
    expect(result.xml).toContain('<ProcedureCode>D1110</ProcedureCode>');
    expect(result.xml).toContain('<SubmittedAmount>150.00</SubmittedAmount>');
  });
});
