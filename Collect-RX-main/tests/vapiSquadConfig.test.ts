import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const SQUAD_CONFIG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../vapi-squad-config.json',
);

interface SquadAssistant {
  assistant: {
    name: string;
    model: { messages: Array<{ role: string; content: string }> };
  };
}

function loadSquad(): SquadAssistant[] {
  const raw = readFileSync(SQUAD_CONFIG_PATH, 'utf-8');
  return (JSON.parse(raw) as { squad: { members: SquadAssistant[] } }).squad.members;
}

function systemPromptFor(members: SquadAssistant[], name: string): string {
  const member = members.find((m) => m.assistant.name === name);
  if (!member) throw new Error(`squad member "${name}" not found`);
  return member.assistant.model.messages.find((m) => m.role === 'system')?.content ?? '';
}

describe('vapi-squad-config.json — anti-impersonation instruction (AA-13)', () => {
  const members = loadSquad();

  // Every agent that actually converses with a live rep (as opposed to
  // IVR_Navigator/Hold_Sentinel, which are silent/DTMF-only by design and
  // never converse) must be able to answer honestly if asked whether it's
  // human -- previously only Claims_Agent had this instruction.
  for (const name of ['Claims_Agent', 'Escalation_Closer', 'Resolution_Closer']) {
    it(`${name} is instructed not to claim to be human`, () => {
      const prompt = systemPromptFor(members, name);
      expect(prompt.toLowerCase()).toContain('do not claim to be human');
    });
  }
});

describe('vapi-squad-config.json — every squad member reports call outcome (AA-11)', () => {
  const members = loadSquad();

  // If a call ends while a given agent has control -- a timeout, or the
  // carrier hanging up -- there must be a webhook + structured-output plan
  // for that leg, or nothing reaches the backend for it. Hold_Sentinel
  // previously had none of the three, unlike every other squad member.
  for (const name of ['IVR_Navigator', 'Hold_Sentinel', 'Claims_Agent', 'Escalation_Closer', 'Resolution_Closer']) {
    it(`${name} has a server webhook and a structuredDataPlan`, () => {
      const member = members.find((m) => m.assistant.name === name);
      expect(member).toBeDefined();
      // Safe: toBeDefined() above proves non-null; expect() doesn't narrow the type.
      const assistant = member!.assistant as unknown as {
        server?: { url?: string };
        serverMessages?: string[];
        analysisPlan?: { structuredDataPlan?: { enabled?: boolean } };
      };
      expect(assistant.server?.url).toBeTruthy();
      expect(assistant.serverMessages).toEqual(expect.arrayContaining(['end-of-call-report']));
      expect(assistant.analysisPlan?.structuredDataPlan?.enabled).toBe(true);
    });
  }
});
