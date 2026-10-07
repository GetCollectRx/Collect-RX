import { describe, expect, it } from 'vitest';
import { validateRequiredDisclosure } from '../src/server/vapi/claimsValidatorWebhook.js';

describe('opening human-interaction disclosure validation', () => {
  it('accepts positive evidence for every required disclosure element in the opening', () => {
    const evidence = validateRequiredDisclosure([
      'Representative: Claims department, how can I help?',
      'Assistant: I am an automated calling assistant on behalf of North Star Dental Practice.',
      'Assistant: I am following up on the status of a submitted claim.',
      'Assistant: You can reach us at 416-555-0199.',
    ].join('\n'));
    expect(evidence).toEqual({
      automation: true,
      practiceIdentity: true,
      claimsStatusPurpose: true,
      contact: true,
    });
  });

  it.each([
    ['automation', 'I am calling on behalf of North Star Dental Practice about claim status. Reach us at 416-555-0199.'],
    ['practiceIdentity', 'I am an automated calling assistant checking claim status. Reach us at 416-555-0199.'],
    ['claimsStatusPurpose', 'I am an automated calling assistant on behalf of North Star Dental Practice. Reach us at 416-555-0199.'],
    ['contact', 'I am an automated calling assistant on behalf of North Star Dental Practice checking claim status.'],
  ])('rejects an opening missing %s evidence', (field, opening) => {
    expect(validateRequiredDisclosure(opening)[field as keyof ReturnType<typeof validateRequiredDisclosure>])
      .toBe(false);
  });

  it('rejects disclosure delivered only after substantive claim discussion', () => {
    const late = [
      'Assistant: I need the adjudication date for claim CLM-100.',
      'Representative: It was adjudicated yesterday.',
      'Assistant: What was the allowed amount?',
      'Representative: One hundred dollars.',
      'Assistant: Was a cheque issued?',
      'Representative: Yes.',
      'Assistant: Please provide the cheque number.',
      'Representative: It is 12345.',
      'Assistant: I am an automated calling assistant on behalf of North Star Dental Practice, following up on claim status. Reach us at 416-555-0199.',
    ].join('\n');
    expect(validateRequiredDisclosure(late)).toEqual({
      automation: false,
      practiceIdentity: false,
      claimsStatusPurpose: false,
      contact: false,
    });
  });

  it('does not accept negated or incidental disclosure phrases', () => {
    const misleading = [
      'Assistant: I am not an automated assistant and I am not calling on behalf of a dental practice.',
      'Representative: Our automated system can provide claim status and our phone number is 416-555-0199.',
    ].join('\n');
    const evidence = validateRequiredDisclosure(misleading);
    expect(evidence.automation).toBe(false);
    expect(evidence.practiceIdentity).toBe(false);
  });
});
