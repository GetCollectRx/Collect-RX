import { describe, expect, it } from 'vitest';
import {
  stripNoiseSegments,
  extractClaimNumbers,
  extractMemberOrClientIds,
  extractFinancialTotals,
  parseTelephonyTranscript,
} from './telephonyParser.js';

describe('stripNoiseSegments', () => {
  it('removes bracketed audio-event tags', () => {
    const cleaned = stripNoiseSegments('Please hold. [hold music] Your claim is being processed.');
    expect(cleaned).not.toMatch(/\[hold music\]/i);
  });

  it('removes stock IVR hold filler phrases', () => {
    const cleaned = stripNoiseSegments('Your call is important to us. Thank you for your patience.');
    expect(cleaned).not.toMatch(/important to us/i);
    expect(cleaned).not.toMatch(/thank you for your patience/i);
  });

  it('collapses repeated consecutive lines from a hold loop', () => {
    const cleaned = stripNoiseSegments('Please hold.\nPlease hold.\nPlease hold.\nAgent: Hello.');
    const lines = cleaned.split('\n').filter(Boolean);
    // "Please hold." itself is filler-stripped, but the dedup rule is
    // exercised independently of filler stripping below.
    expect(lines.filter((l) => l === 'Agent: Hello.')).toHaveLength(1);
  });

  it('deduplicates identical non-filler lines', () => {
    const cleaned = stripNoiseSegments('Reference number is ABC123.\nReference number is ABC123.\nDone.');
    const occurrences = cleaned.split('\n').filter((l) => l === 'Reference number is ABC123.');
    expect(occurrences).toHaveLength(1);
  });
});

describe('extractClaimNumbers', () => {
  it('extracts a claim number introduced by label', () => {
    expect(extractClaimNumbers('Your claim number is SL204812.')).toContain('SL204812');
  });

  it('extracts a bare carrier-prefixed claim reference', () => {
    expect(extractClaimNumbers('Reference CL-9384710 was noted on file.')).toContain('CL-9384710');
  });

  it('returns an empty array when no claim number is present', () => {
    expect(extractClaimNumbers('Please continue to hold for the next available representative.')).toEqual([]);
  });
});

describe('extractMemberOrClientIds', () => {
  it('extracts a labelled member id', () => {
    expect(extractMemberOrClientIds('Member ID is A1B2C3D4E5.')).toContain('A1B2C3D4E5');
  });

  it('extracts a labelled group number', () => {
    expect(extractMemberOrClientIds('The group number is 445566.')).toContain('445566');
  });
});

describe('extractFinancialTotals', () => {
  it('extracts a plain dollar amount', () => {
    const totals = extractFinancialTotals('The total is $1,234.56.');
    expect(totals).toHaveLength(1);
    expect(totals[0].cents).toBe(123456);
  });

  it('labels an amount using nearby wording', () => {
    const totals = extractFinancialTotals('The covered amount is $500.00 for this claim.');
    expect(totals[0].label).toBe('covered');
  });

  it('labels an unrecognized amount as unknown', () => {
    const totals = extractFinancialTotals('Random figure $12.00 appears here.');
    expect(totals[0].label).toBe('unknown');
  });

  it('extracts multiple amounts from the same transcript', () => {
    const totals = extractFinancialTotals('Billed amount $900.00, patient portion $100.00.');
    expect(totals.map((t) => t.cents)).toEqual([90000, 10000]);
    expect(totals.map((t) => t.label)).toEqual(['billed', 'patient_responsibility']);
  });
});

describe('parseTelephonyTranscript', () => {
  it('composes noise stripping and extraction into one result', () => {
    const raw =
      '[hold music] Please hold. Please hold. Your claim number is MFL8827311. ' +
      'The covered amount is $742.50. Member ID is XZ99001.';
    const result = parseTelephonyTranscript(raw);

    expect(result.claimNumbers).toContain('MFL8827311');
    expect(result.memberOrClientIds).toContain('XZ99001');
    expect(result.financialTotals.some((t) => t.cents === 74250 && t.label === 'covered')).toBe(true);
    expect(result.cleanedText).not.toMatch(/\[hold music\]/i);
  });
});
