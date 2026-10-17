import { describe, expect, it } from 'vitest';
import { auditPreSubmissionEvidence } from './preSubmissionAudit.js';

describe('auditPreSubmissionEvidence — crown (CDCP §6.3.5.2)', () => {
  it('blocks submission when the bone-level radiograph is missing', () => {
    const result = auditPreSubmissionEvidence({
      claimId: 'CLM-1',
      cdtCode: 'D2740',
      availableEvidenceTypes: ['perio_chart_6_site', 'ferrule_measurement', 'pre_op_xray', 'clinical_notes'],
    });

    expect(result.readyToSubmit).toBe(false);
    expect(result.procedureSection).toBe('6.3.5.2');
    expect(result.blockingIssues).toContain(
      'Missing: Periapical radiograph demonstrating bone level ≥1:1.5 crown-to-root ratio',
    );
  });

  it('is ready to submit once every required item is present', () => {
    const result = auditPreSubmissionEvidence({
      claimId: 'CLM-2',
      cdtCode: 'D2740',
      availableEvidenceTypes: [
        'perio_chart_6_site',
        'bone_level_xray',
        'ferrule_measurement',
        'pre_op_xray',
        'clinical_notes',
      ],
    });

    expect(result.readyToSubmit).toBe(true);
    expect(result.blockingIssues).toEqual([]);
  });
});

describe('auditPreSubmissionEvidence — scaling (CDCP §6.5.1)', () => {
  it('requires a PSR score even within the 4-unit limit', () => {
    const result = auditPreSubmissionEvidence({
      claimId: 'CLM-3',
      cdtCode: 'D4341',
      availableEvidenceTypes: ['perio_chart_6_site', 'clinical_notes'],
      scalingUnitsRequested: 2,
    });

    expect(result.readyToSubmit).toBe(false);
    expect(result.blockingIssues.some((i) => i.includes('PSR'))).toBe(true);
  });

  it('requires medical rationale once units exceed the 4-unit CDCP limit', () => {
    const result = auditPreSubmissionEvidence({
      claimId: 'CLM-4',
      cdtCode: 'D4341',
      availableEvidenceTypes: ['psr_score', 'perio_chart_6_site', 'clinical_notes'],
      scalingUnitsRequested: 6,
    });

    expect(result.readyToSubmit).toBe(false);
    expect(result.blockingIssues.some((i) => i.includes('>4 units'))).toBe(true);
  });
});

describe('auditPreSubmissionEvidence — unmapped CDT code', () => {
  it('falls back to the general documentation checklist', () => {
    const result = auditPreSubmissionEvidence({
      claimId: 'CLM-5',
      cdtCode: 'D1110',
      availableEvidenceTypes: ['clinical_notes', 'pre_op_xray'],
    });

    expect(result.procedureSection).toBe('general');
    expect(result.readyToSubmit).toBe(true);
  });
});
