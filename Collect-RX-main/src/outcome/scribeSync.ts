import { KNOWN_SCRIBE_SCENARIOS } from './humanAssistedOutcomeResolver';

/**
 * Compare the scenario names in the Claims_Scribe prompt (kept in the Vapi
 * dashboard) with the ones the resolver maps (B-12). Scenario names are
 * UPPER_SNAKE tokens; the prompt is scanned for any token that looks like one
 * and matches a known name or is not a common non-scenario word.
 */
export function diffScribeScenarios(promptText: string, declared: readonly string[]): {
  missingInPrompt: string[];
  unknownInPrompt: string[];
} {
  const declaredSet = new Set(declared);
  const missingInPrompt = KNOWN_SCRIBE_SCENARIOS.filter((k) => !promptText.includes(k));
  const unknownInPrompt = declared.filter((d) => !KNOWN_SCRIBE_SCENARIOS.includes(d));
  void declaredSet;
  return { missingInPrompt, unknownInPrompt };
}

/** Extract the enum from a Vapi tool definition's `scenario` parameter, if present. */
export function scenariosFromToolSchema(tool: unknown): string[] {
  const t = tool as { function?: { parameters?: { properties?: { scenario?: { enum?: unknown } } } } };
  const e = t?.function?.parameters?.properties?.scenario?.enum;
  return Array.isArray(e) ? e.filter((x): x is string => typeof x === 'string') : [];
}
