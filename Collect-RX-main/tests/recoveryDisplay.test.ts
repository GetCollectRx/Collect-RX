import { describe, expect, it } from 'vitest';
import {
  claimStatusLabel,
  callOutcomeLabel,
  lastOutcomeLine,
  carrierLabel,
  isDemoVapiCall,
} from '../src/lib/recoveryDisplay';

describe('recoveryDisplay', () => {
  it('maps claim statuses to practice-friendly labels', () => {
    expect(claimStatusLabel('IN_QUEUE')).toBe('In queue');
    expect(claimStatusLabel('CALLING')).toBe('Calling');
    expect(claimStatusLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('formats call outcomes and one-line list summaries', () => {
    expect(callOutcomeLabel('DENIED')).toBe('Denied');
    expect(callOutcomeLabel(null)).toBe('In progress');
    expect(lastOutcomeLine('DENIED', 'Missing pre-auth')).toBe('Denied — Missing pre-auth');
    expect(lastOutcomeLine(null, null)).toBe('No calls yet');
  });

  it('formats carrier labels', () => {
    expect(carrierLabel('sun_life')).toBe('Sun Life');
    expect(carrierLabel('custom_carrier')).toBe('custom carrier');
  });

  it('detects demo vapi call ids', () => {
    expect(isDemoVapiCall('demo-in-progress-sl-002341')).toBe(true);
    expect(isDemoVapiCall('live-abc-123')).toBe(false);
    expect(isDemoVapiCall(null)).toBe(false);
  });
});
