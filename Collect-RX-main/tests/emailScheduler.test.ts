import { describe, expect, it } from 'vitest';
import {
  generateFollowUpEmailHtml,
  generateInitialEmailHtml,
} from '../src/server/learning/emailScheduler.js';

// CASL s.6(2): every commercial electronic message must identify the sender,
// include contact information, and carry an unsubscribe mechanism. These pin
// the scheduler's outreach emails to the shared branded layout so a future
// edit cannot silently drop the footer again.
describe('emailScheduler outreach templates', () => {
  const cases = [
    ['initial', generateInitialEmailHtml('Bright Smiles Dental')],
    ['follow-up', generateFollowUpEmailHtml('Bright Smiles Dental')],
  ] as const;

  it.each(cases)('%s email addresses the prospect', (_label, html) => {
    expect(html).toContain('Bright Smiles Dental');
  });

  it.each(cases)('%s email carries the CASL unsubscribe mechanism', (_label, html) => {
    expect(html.toLowerCase()).toContain('unsubscribe');
  });

  it.each(cases)('%s email identifies the sender with contact info', (_label, html) => {
    expect(html).toContain('CollectRx');
    expect(html).toContain('collectrx.ca');
  });

  it.each(cases)('%s email leaks no unrendered placeholders', (_label, html) => {
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('{{');
  });
});
