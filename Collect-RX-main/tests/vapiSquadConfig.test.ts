/**
 * Vapi squad configuration — validates vapi-squad-config.json against the behavior
 * CLAUDE.md documents (five agents, IVR_Navigator/Hold_Sentinel silent & DTMF-only,
 * correct handoff wiring, PHI-free call-level metadata) without needing a live Vapi
 * API key or placing a real call — this sandbox has neither.
 *
 * Anything requiring an actual live call (real carrier IVR navigation, real speech
 * quality, real handoff latency) is explicitly OUT OF SCOPE here and cannot be
 * validated without production Vapi/Twilio credentials — flagged, not silently skipped.
 */
import { describe, expect, it } from 'vitest';
import squadConfig from '../vapi-squad-config.json';

type Assistant = {
  name: string;
  firstMessage: string;
  firstMessageMode: string;
  model: { messages: Array<{ role: string; content: string }> };
};
type Member = { assistant: Assistant; assistantDestinations: Array<{ assistantName: string; description: string }> };

const members = squadConfig.squad.members as Member[];

function byName(name: string): Member {
  const m = members.find((x) => x.assistant.name === name);
  if (!m) throw new Error(`assistant ${name} not found`);
  return m;
}

describe('Squad composition', () => {
  it('has exactly the five documented agents (CLAUDE.md: IVR_Navigator, Hold_Sentinel, Claims_Agent, Escalation_Closer, Resolution_Closer)', () => {
    const names = members.map((m) => m.assistant.name).sort();
    expect(names).toEqual(
      ['Claims_Agent', 'Escalation_Closer', 'Hold_Sentinel', 'IVR_Navigator', 'Resolution_Closer'].sort(),
    );
  });
});

describe('IVR_Navigator — must be silent, DTMF-only, never converses', () => {
  const ivr = byName('IVR_Navigator').assistant;

  it('never speaks first and has no scripted firstMessage', () => {
    expect(ivr.firstMessage).toBe('');
    expect(ivr.firstMessageMode).toBe('assistant-waits-for-user');
  });

  it('system prompt explicitly forbids conversational speech and mandates dtmf tool use', () => {
    const prompt = ivr.model.messages[0].content;
    expect(prompt).toMatch(/NEVER speak conversational sentences/i);
    expect(prompt).toMatch(/dtmf tool/i);
  });

  it('hands off to Claims_Agent the moment a live human is detected', () => {
    const dest = byName('IVR_Navigator').assistantDestinations.find((d) => d.assistantName === 'Claims_Agent');
    expect(dest).toBeDefined();
    expect(dest!.description.toLowerCase()).toMatch(/human/);
  });
});

describe('Hold_Sentinel — must stay silent through hold music/queue messages', () => {
  const hold = byName('Hold_Sentinel').assistant;

  it('never speaks first and has no scripted firstMessage', () => {
    expect(hold.firstMessage).toBe('');
    expect(hold.firstMessageMode).toBe('assistant-waits-for-user');
  });

  it('system prompt mandates total silence except for the handoff trigger', () => {
    const prompt = hold.model.messages[0].content;
    expect(prompt).toMatch(/stay completely silent/i);
  });

  it('hands off to Claims_Agent only, on live human detection', () => {
    const dests = byName('Hold_Sentinel').assistantDestinations;
    expect(dests.map((d) => d.assistantName)).toEqual(['Claims_Agent']);
  });
});

describe('Claims_Agent — carries the CRTC disclosure and the reference-number capture rule', () => {
  const claims = byName('Claims_Agent').assistant;

  it('speaks first with a disclosure containing automated-nature + practice name + callback number', () => {
    expect(claims.firstMessageMode).toBe('assistant-speaks-first');
    expect(claims.firstMessage.toLowerCase()).toMatch(/automated/);
    expect(claims.firstMessage).toContain('{{practice_name}}');
    expect(claims.firstMessage).toContain('{{practice_phone}}');
  });

  it('system prompt blocks handoff until a reference number has been requested', () => {
    const prompt = claims.model.messages[0].content;
    expect(prompt.toLowerCase()).toMatch(/reference number/);
    expect(prompt).toMatch(/HANDOFF GATE/);
  });

  it('routes to Escalation_Closer and Resolution_Closer, plus back to IVR_Navigator / Hold_Sentinel', () => {
    const names = byName('Claims_Agent').assistantDestinations.map((d) => d.assistantName).sort();
    expect(names).toEqual(['Escalation_Closer', 'Hold_Sentinel', 'IVR_Navigator', 'Resolution_Closer'].sort());
  });
});

describe('Escalation_Closer and Resolution_Closer — terminal nodes, no further handoff', () => {
  it.each(['Escalation_Closer', 'Resolution_Closer'])('%s has no outgoing assistantDestinations', (name) => {
    expect(byName(name).assistantDestinations).toEqual([]);
  });
});

describe('Squad-level call metadata carries no PHI (mirrors src/vapi/client.ts metadata contract)', () => {
  it('only claim_id, carrier_code, practice_name appear at the squad metadata level', () => {
    const metadata = squadConfig.metadata as Record<string, string>;
    expect(Object.keys(metadata).sort()).toEqual(['carrier_code', 'claim_id', 'practice_name']);
  });
});

describe('OUT OF SCOPE in this sandbox — cannot be validated without live Vapi/Twilio credentials', () => {
  it.todo('real IVR menu navigation accuracy against a live carrier phone tree');
  it.todo('handoff latency / audio quality on a real call');
  it.todo('whether Vapi actually deletes call recordings post-call (recordingEnabled + retention policy)');
});
