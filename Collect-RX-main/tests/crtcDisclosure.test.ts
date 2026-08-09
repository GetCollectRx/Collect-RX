/**
 * CRTC AI-disclosure — src/vapi/client.ts + vapi-squad-config.json.
 *
 * Before this test existed, there was ZERO automated coverage of the actual disclosure
 * a live carrier representative hears (found during pre-pilot validation, 2026-08-09).
 * ADAD Rule 4 (docs/compliance/crtc-disclosure-decision.md) requires, within the first
 * 10 seconds of a live rep answering: (1) identify the automated nature of the call,
 * (2) state the practice name, (3) provide a callback number.
 */
import { describe, expect, it, vi } from 'vitest';
import squadConfig from '../vapi-squad-config.json';

const ENV_BACKUP = { ...process.env };

function assistantByName(name: string): { firstMessage: string; firstMessageMode: string } {
  const member = (squadConfig.squad.members as Array<{ assistant: { name: string; firstMessage: string; firstMessageMode: string } }>).find(
    (m) => m.assistant.name === name,
  );
  if (!member) throw new Error(`assistant ${name} not found in vapi-squad-config.json`);
  return member.assistant;
}

describe('The disclosure actually spoken to a live rep (Claims_Agent.firstMessage)', () => {
  it('discloses automated nature, uses the practice-name variable, and provides a callback-number variable', () => {
    const claimsAgent = assistantByName('Claims_Agent');
    expect(claimsAgent.firstMessageMode).toBe('assistant-speaks-first');
    const msg = claimsAgent.firstMessage.toLowerCase();
    expect(msg).toMatch(/automated/);
    expect(claimsAgent.firstMessage).toContain('{{practice_name}}');
    expect(claimsAgent.firstMessage).toContain('{{practice_phone}}');
  });
});

describe('IVR_Navigator and Hold_Sentinel never speak a disclosure to a machine/hold queue', () => {
  it('IVR_Navigator firstMessage is empty and waits for input', () => {
    const ivr = assistantByName('IVR_Navigator');
    expect(ivr.firstMessage).toBe('');
    expect(ivr.firstMessageMode).toBe('assistant-waits-for-user');
  });

  it('Hold_Sentinel firstMessage is empty and waits for input', () => {
    const hold = assistantByName('Hold_Sentinel');
    expect(hold.firstMessage).toBe('');
    expect(hold.firstMessageMode).toBe('assistant-waits-for-user');
  });
});

describe('src/vapi/client.ts disclosure_message variable — dead-code finding', () => {
  it('is computed and sent to Vapi, but no assistant firstMessage in the deployed squad references it', async () => {
    vi.resetModules();
    process.env.VAPI_API_KEY = 'test-key';
    process.env.VAPI_SQUAD_ID = 'squad-test';
    process.env.VAPI_PHONE_NUMBER_ID = 'phone-test';

    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(String(init.body));
        return { ok: true, json: async () => ({ id: 'call-123', status: 'queued', createdAt: new Date().toISOString() }) } as Response;
      }),
    );

    const { initiateCall, CARRIER_PHONE_MAP } = await import('../src/vapi/client.js');
    await initiateCall({
      claimId: 'claim-1',
      carrierId: 'sun_life',
      practiceId: 'practice-1',
      patientToken: 'token-1',
      patientName: 'Jane Doe',
      patientDob: '1985-06-12',
      policyNumber: 'POL-1',
      carrierPhone: CARRIER_PHONE_MAP.sun_life,
      claimNumber: 'CLM-1',
      daysOutstanding: 45,
      billedAmount: 100,
      outstandingAmount: 100,
      practiceName: 'Fixture Dental',
      providerNumber: 'PN-1',
      practicePhone: '+15551234567',
    });

    const overrides = capturedBody!.assistantOverrides as { variableValues: Record<string, unknown> };
    expect(typeof overrides.variableValues.disclosure_message).toBe('string');
    expect(overrides.variableValues.disclosure_message).toContain('Fixture Dental');

    // GAP (informational, not a compliance failure — Claims_Agent's hardcoded firstMessage
    // above already satisfies ADAD Rule 4 independently): the disclosure_message variable
    // built here is never referenced by name ({{disclosure_message}}) anywhere in
    // vapi-squad-config.json. It's live, PHI-adjacent business logic with no consumer —
    // worth removing or actually wiring in, so the two disclosure texts can't drift apart.
    const configText = JSON.stringify(squadConfig);
    expect(configText.includes('{{disclosure_message}}')).toBe(false);

    vi.unstubAllGlobals();
    process.env = { ...ENV_BACKUP };
  });
});
