/**
 * Reads the validation-lab scenario registry (248 scenarios generated from
 * SCENARIO-MASTER.csv) and decides how the carrier simulator plays each one.
 *
 * The registry's expected outcomes are free text from the spreadsheet. Each is
 * mapped to an outcome class the simulator can act out and the product state
 * that class should produce. A scenario whose text maps to nothing specific
 * falls back to its carrier persona; the mapping never invents a stricter
 * expectation than the registry states.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type OutcomeClass =
  | 'PAID'
  | 'PARTIAL'
  | 'DENIED_NOT_COVERED'
  | 'DENIED_MAX'
  | 'DENIED'
  | 'PROCESSING'
  | 'NOT_RECEIVED'
  | 'NEED_INFO'
  | 'REFUSAL'
  | 'CALLBACK'
  | 'TECH_FAIL'
  | 'UNCLEAR';

export interface RegistryScenario {
  id: string;
  tier: string;
  name: string;
  layer: string;
  harness: string;
  carrierPersonas: string[];
  carrierName: string | null;
  curveball: string | null;
  expectedOutcomeText: string | null;
}

export interface CallScenario extends RegistryScenario {
  outcomeClass: OutcomeClass;
}

/** Harness types that describe a phone call the simulator can play. */
const CALL_HARNESSES = new Set(['carrier_conversation', 'telephony_controlled', 'transcript_outcome']);

const CARRIER_NAME_TO_ID: Record<string, string> = {
  'sun life': 'sun_life',
  'canada life': 'canada_life',
  manulife: 'manulife',
  'green shield canada': 'green_shield',
  'rbc insurance': 'rbc',
  'telus adjudicare': 'telus_adjudicare',
};

export function carrierIdForScenario(s: RegistryScenario): string | null {
  if (!s.carrierName) return null;
  return CARRIER_NAME_TO_ID[s.carrierName.toLowerCase()] ?? null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

export function parseRegistry(raw: unknown): RegistryScenario[] {
  const list = asRecord(raw).scenarios;
  if (!Array.isArray(list)) return [];
  return list.map((entry) => {
    const s = asRecord(entry);
    const personas = asRecord(s.personas);
    const initial = asRecord(asRecord(s.preconditions).initialState);
    const expected = Array.isArray(s.expected) ? s.expected.map(asRecord) : [];
    const outcome = expected.find((e) => e.id === 'expected-outcome');
    const carrier = asString(initial.carrier);
    return {
      id: asString(s.id) ?? 'UNKNOWN',
      tier: asString(s.tier) ?? 'P2',
      name: asString(s.name) ?? '',
      layer: asString(s.layer) ?? '',
      harness: asString(s.harness) ?? '',
      carrierPersonas: Array.isArray(personas.carrier) ? personas.carrier.filter((p): p is string => typeof p === 'string') : [],
      carrierName: carrier && carrier !== 'All' ? carrier : null,
      curveball: asString(initial.curveball),
      expectedOutcomeText: outcome ? asString(outcome.value) : null,
    };
  });
}

export function classifyScenario(s: RegistryScenario): OutcomeClass {
  const text = (s.expectedOutcomeText ?? '').toLowerCase();
  const persona = s.carrierPersonas[0] ?? '';
  if (text.includes('carrier_block') || text.includes('carrier refusal') || persona === 'automation_refusal_rep') return 'REFUSAL';
  if (text.includes('technical') || text.includes('failed (ivr') || text === 'timeout' || text === 'no_answer' || text.includes('end immediately')) return 'TECH_FAIL';
  if (text.includes('callback') || persona === 'callback_only_rep') return 'CALLBACK';
  if (text.includes('claim_not_received') || persona === 'duplicate_claim_rep') return 'NOT_RECEIVED';
  if (text.includes('not_covered')) return 'DENIED_NOT_COVERED';
  if (text.includes('max_benefits')) return 'DENIED_MAX';
  if (/\bdenied\b/u.test(text) && !text.includes('not denied')) return 'DENIED';
  if (text.includes('need_information') || text.includes('x-ray') || persona === 'documentation_requester') return 'NEED_INFO';
  if (text.includes('processing') || text.includes('pending') || persona === 'delayed_processing_rep' || persona === 'vague_pending_rep') return 'PROCESSING';
  if (persona === 'partial_payment_rep') return 'PARTIAL';
  if (text.includes('claim_paid') || text === 'resolved') return 'PAID';
  if (text.includes('unclear') || text.includes('supervisor') || text.includes('human') || persona === 'contradictory_rep' || persona === 'supervisor_gatekeeper' || persona === 'wrong_patient_conflator' || persona === 'excessive_phi_requester') return 'UNCLEAR';
  if (persona === 'denial_explainer') return 'DENIED';
  if (persona === 'cooperative_rep') return 'PAID';
  return 'UNCLEAR';
}

export function isCallScenario(s: RegistryScenario): boolean {
  return CALL_HARNESSES.has(s.harness);
}

let cache: RegistryScenario[] | null = null;

export function registryPath(): string {
  return path.resolve(process.cwd(), 'validation-lab/registry/scenarios.json');
}

export function loadRegistry(file = registryPath()): RegistryScenario[] {
  if (!cache) cache = parseRegistry(JSON.parse(readFileSync(file, 'utf8')) as unknown);
  return cache;
}

export function loadCallScenarios(): CallScenario[] {
  return loadRegistry()
    .filter(isCallScenario)
    .map((s) => ({ ...s, outcomeClass: classifyScenario(s) }));
}

/** Sandbox claim numbers carry their scenario: SBX-<scenarioId>-<seq>. */
export function sandboxClaimNumber(scenarioId: string, seq: number): string {
  return `SBX-${scenarioId}-${String(seq).padStart(4, '0')}`;
}

export function scenarioIdFromClaimNumber(claimNumber: string | null | undefined): string | null {
  const m = /^SBX-([A-Za-z0-9_-]+)-\d{4}$/u.exec(claimNumber ?? '');
  return m?.[1] ?? null;
}

export function findCallScenario(id: string | null): CallScenario | null {
  if (!id) return null;
  return loadCallScenarios().find((s) => s.id === id) ?? null;
}
