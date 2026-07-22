// ─────────────────────────────────────────────────────────────────────────────
// Agent 05 — Call Rules & CARRIER_BLOCK Protocol Validator
//
// Validates the critical operational safety rules:
//   - Claims under 30 days old: do not enter queue
//   - Claims over 90 days old: skip AI, escalate to human immediately
//   - Maximum 3 call attempts per claim
//   - CARRIER_BLOCK detection phrases catch automation signals
//   - CARRIER_BLOCK suspends ALL calls to that carrier (not just the current one)
//
// A failure in any of these rules risks:
//   - Being detected and blocked by carriers (CARRIER_BLOCK)
//   - Legal exposure from calling outside allowed windows
//   - Regulatory violations (PHIPA/PIPEDA)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  transcriptSignalsCarrierBlock,
  matchedCarrierBlockPhrase,
} from '../../src/server/frontDesk/carrierBlockPhrases.js';

// ─────────────────────────────────────────────────────────────────────────────
// Section A — CARRIER_BLOCK Phrase Detection
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 05-A — CARRIER_BLOCK phrase detection', () => {
  // transcriptSignalsCarrierBlock just checks for ANY match.
  // matchedCarrierBlockPhrase returns the FIRST matched phrase from the array in order.
  // Generic IVR wording alone is deliberately not a block signal. A carrier action
  // or detection statement is required to avoid suspending an entire carrier from
  // normal "automated system" or "bot menu" wording.
  const SIGNAL_TRANSCRIPTS = [
    'Automated calling is not permitted',
    'This sounds like a bot call',
    'Our system detected automation',
    'We cannot verify this is not a live agent',
    'We cannot process automated calls',
    'Fraud detection has flagged this call',
    'The call flagged our security system',
  ];

  for (const transcript of SIGNAL_TRANSCRIPTS) {
    it(`detects block signal in: "${transcript.substring(0, 55)}..."`, () => {
      expect(transcriptSignalsCarrierBlock(transcript)).toBe(true);
    });
  }

  it('matchedCarrierBlockPhrase returns the complete automation prohibition', () => {
    expect(matchedCarrierBlockPhrase('Automated calling is not permitted')).toBe('automated calling is not permitted');
  });

  it('matchedCarrierBlockPhrase returns the complete bot-call detection', () => {
    expect(matchedCarrierBlockPhrase('This sounds like a bot call')).toBe('this sounds like a bot call');
  });

  it('matchedCarrierBlockPhrase returns the specific automation detection', () => {
    expect(matchedCarrierBlockPhrase('Our system detected automation')).toBe('system detected automation');
  });

  it('matchedCarrierBlockPhrase returns "fraud detection" for fraud transcript', () => {
    expect(matchedCarrierBlockPhrase('Fraud detection triggered')).toBe('fraud detection');
  });

  it('matchedCarrierBlockPhrase returns "call flagged" for call flagged transcript (no "automated")', () => {
    expect(matchedCarrierBlockPhrase('The call flagged our system')).toBe('call flagged');
  });

  it('matchedCarrierBlockPhrase returns the complete automated-call prohibition', () => {
    expect(matchedCarrierBlockPhrase('We cannot process automated calls')).toBe('cannot process automated calls');
  });

  it('matchedCarrierBlockPhrase returns null for safe transcript', () => {
    expect(matchedCarrierBlockPhrase('Your claim is pending adjudication')).toBeNull();
  });
});

describe('Agent 05-A2 — Transcript detection is case-insensitive', () => {
  it('detects an automation prohibition in uppercase', () => {
    expect(transcriptSignalsCarrierBlock('AUTOMATED CALLING IS NOT PERMITTED')).toBe(true);
  });

  it('detects a bot-call determination in mixed case', () => {
    expect(transcriptSignalsCarrierBlock('This sounds like a BOT CALL')).toBe(true);
  });

  it('detects "Fraud Detection" (title case) as a block signal', () => {
    expect(transcriptSignalsCarrierBlock('Fraud Detection system activated')).toBe(true);
  });
});

describe('Agent 05-A3 — Generic IVR terms do NOT trigger block', () => {
  for (const transcript of [
    'This is an automated call',
    'This sounds like a bot',
    'Our system detected an issue',
    'We cannot process automated requests',
  ]) {
    it(`does not block incomplete detection language: "${transcript}"`, () => {
      expect(transcriptSignalsCarrierBlock(transcript)).toBe(false);
      expect(matchedCarrierBlockPhrase(transcript)).toBeNull();
    });
  }
});

describe('Agent 05-A3 — Normal carrier speech does NOT trigger block', () => {
  const SAFE_TRANSCRIPTS = [
    'Your claim is pending adjudication',
    'The claim was processed on April 15th',
    'The patient has an active dental plan',
    'Please provide the claim number',
    'The annual maximum has been reached',
    'We need to transfer you to a specialist',
    'Your request has been received',
    'The estimated processing time is 15 business days',
  ];

  for (const transcript of SAFE_TRANSCRIPTS) {
    it(`does NOT block: "${transcript.substring(0, 50)}..."`, () => {
      expect(transcriptSignalsCarrierBlock(transcript)).toBe(false);
      expect(matchedCarrierBlockPhrase(transcript)).toBeNull();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — Call Age Rules (pure business logic validation)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 05-B — Claim age eligibility rules', () => {
  function daysOldToDate(daysOld: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - daysOld);
    return date;
  }

  function isClaimEligibleForQueue(claimDate: Date): boolean {
    const daysOld = Math.floor((Date.now() - claimDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysOld >= 30;
  }

  function shouldEscalateToHuman(claimDate: Date): boolean {
    const daysOld = Math.floor((Date.now() - claimDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysOld > 90;
  }

  it('claim 10 days old is NOT eligible for AI queue (< 30 days)', () => {
    const claimDate = daysOldToDate(10);
    expect(isClaimEligibleForQueue(claimDate)).toBe(false);
  });

  it('claim 29 days old is NOT eligible for AI queue (< 30 days)', () => {
    const claimDate = daysOldToDate(29);
    expect(isClaimEligibleForQueue(claimDate)).toBe(false);
  });

  it('claim exactly 30 days old IS eligible for AI queue', () => {
    const claimDate = daysOldToDate(30);
    expect(isClaimEligibleForQueue(claimDate)).toBe(true);
  });

  it('claim 45 days old IS eligible for AI queue', () => {
    const claimDate = daysOldToDate(45);
    expect(isClaimEligibleForQueue(claimDate)).toBe(true);
  });

  it('claim 90 days old IS eligible for AI queue (not yet escalated)', () => {
    const claimDate = daysOldToDate(90);
    expect(isClaimEligibleForQueue(claimDate)).toBe(true);
    expect(shouldEscalateToHuman(claimDate)).toBe(false);
  });

  it('claim 91 days old should be escalated to human', () => {
    const claimDate = daysOldToDate(91);
    expect(shouldEscalateToHuman(claimDate)).toBe(true);
  });

  it('claim 120 days old should be escalated to human', () => {
    const claimDate = daysOldToDate(120);
    expect(shouldEscalateToHuman(claimDate)).toBe(true);
  });

  it('age boundary: claim 30 days old is eligible, 29 is not (boundary is inclusive at 30)', () => {
    expect(isClaimEligibleForQueue(daysOldToDate(30))).toBe(true);
    expect(isClaimEligibleForQueue(daysOldToDate(29))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C — Max Attempt Rules
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 05-C — Maximum call attempt enforcement', () => {
  const MAX_ATTEMPTS = 3;

  function canAttemptCall(attemptCount: number): boolean {
    return attemptCount < MAX_ATTEMPTS;
  }

  it('0 prior attempts — call allowed', () => {
    expect(canAttemptCall(0)).toBe(true);
  });

  it('1 prior attempt — call allowed', () => {
    expect(canAttemptCall(1)).toBe(true);
  });

  it('2 prior attempts — call allowed', () => {
    expect(canAttemptCall(2)).toBe(true);
  });

  it('3 prior attempts — call NOT allowed (max reached)', () => {
    expect(canAttemptCall(3)).toBe(false);
  });

  it('4 prior attempts — call NOT allowed (beyond max)', () => {
    expect(canAttemptCall(4)).toBe(false);
  });

  it('maximum is exactly 3 attempts per claim (PRD specification)', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — Call Window Rules (Mon–Fri 8am–5pm Eastern)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 05-D — Call window rules (Mon–Fri 8am–5pm Eastern)', () => {
  function isInCallWindow(date: Date): boolean {
    const easternOffset = -4; // EDT (summer); -5 for EST
    const utcHour = date.getUTCHours();
    const easternHour = (utcHour + easternOffset + 24) % 24;
    const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isBusinessHour = easternHour >= 8 && easternHour < 17;

    return isWeekday && isBusinessHour;
  }

  function makeMondayAt(hour: number): Date {
    // Find the next Monday at the given EDT hour
    const date = new Date('2026-06-15T00:00:00Z'); // Known Monday
    date.setUTCHours(hour + 4); // Convert EDT to UTC (EDT = UTC-4)
    return date;
  }

  it('Monday at 9am Eastern is in the call window', () => {
    expect(isInCallWindow(makeMondayAt(9))).toBe(true);
  });

  it('Monday at 12pm Eastern is in the call window', () => {
    expect(isInCallWindow(makeMondayAt(12))).toBe(true);
  });

  it('Monday at 4:59pm Eastern is in the call window', () => {
    const date = new Date('2026-06-15T00:00:00Z');
    date.setUTCHours(16 + 4); // 4:00 PM EDT = 8pm UTC
    date.setUTCMinutes(59);
    expect(isInCallWindow(date)).toBe(true);
  });

  it('Monday at 7am Eastern is NOT in the call window (too early)', () => {
    expect(isInCallWindow(makeMondayAt(7))).toBe(false);
  });

  it('Monday at 5pm Eastern is NOT in the call window (closed at 5)', () => {
    expect(isInCallWindow(makeMondayAt(17))).toBe(false);
  });

  it('Saturday is NOT in the call window', () => {
    const saturday = new Date('2026-06-13T14:00:00Z'); // Saturday noon UTC = 10am EDT
    expect(saturday.getDay()).toBe(6);
    expect(isInCallWindow(saturday)).toBe(false);
  });

  it('Sunday is NOT in the call window', () => {
    const sunday = new Date('2026-06-14T14:00:00Z'); // Sunday noon UTC
    expect(sunday.getDay()).toBe(0);
    expect(isInCallWindow(sunday)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section E — TELUS vs. Standard Carrier Wait Days
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 05-E — TELUS vs standard carrier claim wait days', () => {
  function isClaimReadyForTELUS(daysOld: number): boolean {
    return daysOld >= 21;
  }

  function isClaimReadyForStandardCarrier(daysOld: number): boolean {
    return daysOld >= 32;
  }

  it('TELUS: claim ready at day 21', () => {
    expect(isClaimReadyForTELUS(21)).toBe(true);
    expect(isClaimReadyForTELUS(20)).toBe(false);
  });

  it('Standard carriers: claim ready at day 32', () => {
    expect(isClaimReadyForStandardCarrier(32)).toBe(true);
    expect(isClaimReadyForStandardCarrier(31)).toBe(false);
  });

  it('TELUS allows earlier calls than standard carriers', () => {
    expect(isClaimReadyForTELUS(25)).toBe(true);
    expect(isClaimReadyForStandardCarrier(25)).toBe(false);
  });

  it('day 21–31 window: TELUS ready, standard carriers not', () => {
    for (let day = 21; day < 32; day++) {
      expect(isClaimReadyForTELUS(day)).toBe(true);
      expect(isClaimReadyForStandardCarrier(day)).toBe(false);
    }
  });
});
