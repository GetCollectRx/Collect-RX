import { describe, expect, it } from 'vitest';
import { validatePredetSubmission } from './predetSubmissionRules';

describe('validatePredetSubmission', () => {
  it('passes when required artifacts are attested for a crown', () => {
    const result = validatePredetSubmission({
      carrierId: 'sun_life',
      procedureCodes: ['D2740'],
      artifactAttestations: {
        periapical_xray: true,
        clinical_narrative: true,
      },
    });
    expect(result.passed).toBe(true);
    expect(result.missingArtifacts).toHaveLength(0);
  });

  it('flags missing X-ray for CDCP crown', () => {
    const result = validatePredetSubmission({
      carrierId: 'sun_life',
      procedureCodes: ['D2740'],
      artifactAttestations: { clinical_narrative: true },
    });
    expect(result.passed).toBe(false);
    expect(result.missingArtifacts).toContain('periapical_xray');
  });

  it('skips validation for non-CDCP carriers', () => {
    const result = validatePredetSubmission({
      carrierId: 'manulife',
      procedureCodes: ['D2740'],
    });
    expect(result.passed).toBe(true);
  });
});
