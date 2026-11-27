import { describe, expect, it } from 'vitest';
import { normalizePayerKey, pickPayerDisplayName, UNKNOWN_PAYER_KEY } from './payerNormalization';

describe('normalizePayerKey', () => {
  it.each([
    ['Synthetic Mutual Insurance Inc.', 'synthetic mutual'],
    ['SYNTHETIC MUTUAL INS.', 'synthetic mutual'],
    ['synthetic mutual', 'synthetic mutual'],
    ['The Synthetic Mutual Insurance Company Ltd', 'synthetic mutual'],
    ['Synthetic Mutual Insurance Company of Canada', 'synthetic mutual'],
    ['Synth\u00e9tique Assurances Lt\u00e9e', 'synthetique'],
    ['Fake & Sample General', 'fake and sample general'],
  ])('%s groups as %s', (raw, key) => {
    expect(normalizePayerKey(raw)).toBe(key);
  });

  it('keeps words that tell two payers apart', () => {
    expect(normalizePayerKey('Placeholder Life Insurance')).toBe('placeholder life');
    expect(normalizePayerKey('Placeholder General Insurance')).toBe('placeholder general');
    expect(normalizePayerKey('Placeholder Life Insurance')).not.toBe(normalizePayerKey('Placeholder General Insurance'));
  });

  it('drops "canada" only at the end, so a leading Canada stays part of the name', () => {
    expect(normalizePayerKey('Canada Sample Life')).toBe('canada sample life');
    expect(normalizePayerKey('Sample Canada')).toBe('sample');
  });

  it('never reduces a name to nothing', () => {
    expect(normalizePayerKey('Insurance')).toBe('insurance');
    expect(normalizePayerKey('The')).toBe('the');
    expect(normalizePayerKey('Insurance Inc')).toBe('insurance');
  });

  it.each([null, undefined, '', '   ', '---'])('maps unusable input %j to the unknown key', (raw) => {
    expect(normalizePayerKey(raw)).toBe(UNKNOWN_PAYER_KEY);
  });
});

describe('pickPayerDisplayName', () => {
  it('prefers the most frequent spelling', () => {
    expect(pickPayerDisplayName(['SYNTHETIC MUTUAL INS.', 'Synthetic Mutual Insurance Inc.', 'SYNTHETIC MUTUAL INS.'])).toBe('SYNTHETIC MUTUAL INS.');
  });

  it('breaks ties by the longest spelling, then alphabetically, independent of order', () => {
    const names = ['Synthetic Mutual', 'Synthetic Mutual Insurance Inc.'];
    expect(pickPayerDisplayName(names)).toBe('Synthetic Mutual Insurance Inc.');
    expect(pickPayerDisplayName([...names].reverse())).toBe('Synthetic Mutual Insurance Inc.');
    expect(pickPayerDisplayName(['Bbb', 'Aaa'])).toBe('Aaa');
  });

  it('ignores blank spellings and falls back when none are usable', () => {
    expect(pickPayerDisplayName(['  ', ''])).toBe('Unknown payer');
    expect(pickPayerDisplayName([])).toBe('Unknown payer');
  });
});
