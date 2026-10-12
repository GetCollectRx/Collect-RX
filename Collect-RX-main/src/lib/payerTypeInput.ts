/**
 * Payer program parsing shared by the import pipeline and the import screens, so
 * a file is classified the same way in the preview as on the server. Pure and
 * dependency-free: it is bundled into the browser.
 *
 * Unrecognized values are rejected, never guessed: a wrong program would route a
 * claim to (or away from) carrier calls.
 */
export type PayerTypeValue = 'PRIVATE' | 'CDCP' | 'PROVINCIAL';

const ALIASES: Readonly<Record<string, PayerTypeValue>> = {
  private: 'PRIVATE',
  'private plan': 'PRIVATE',
  commercial: 'PRIVATE',
  employer: 'PRIVATE',
  group: 'PRIVATE',
  cdcp: 'CDCP',
  'canadian dental care plan': 'CDCP',
  provincial: 'PROVINCIAL',
  'provincial program': 'PROVINCIAL',
  hso: 'PROVINCIAL',
  'healthy smiles ontario': 'PROVINCIAL',
  odsp: 'PROVINCIAL',
};

export type PayerTypeParse =
  | { ok: true; value: PayerTypeValue | null }
  | { ok: false; error: string };

/** Empty or absent input parses to `null` (not classified); anything else must be recognized. */
export function parsePayerTypeInput(value: unknown): PayerTypeParse {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'Payer type must be text' };
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, ' ');
  if (normalized === '') return { ok: true, value: null };
  const direct = ALIASES[normalized];
  if (direct) return { ok: true, value: direct };
  return {
    ok: false,
    error: `Unrecognized payer type "${value.trim()}". Use PRIVATE, CDCP or PROVINCIAL.`,
  };
}

/**
 * The only program a carrier or plan name states on its own is the Canadian
 * Dental Care Plan. Anything else (including "Sun Life") says nothing about the
 * funding program, so it returns null rather than a guess.
 */
export function payerTypeFromPlanName(raw: string | null | undefined): PayerTypeValue | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
  return key.includes('cdcp') || key.includes('canadian_dental_care_plan') ? 'CDCP' : null;
}

/**
 * One row's program from its own signals: the Payer Type cell and the plan
 * name. A plan name that says CDCP classifies the row as CDCP when the cell is
 * empty, and disagrees with a cell that says anything else, which is an error
 * rather than a coin flip.
 */
export function resolveRowPayerType(
  cell: unknown,
  planName: string | null | undefined,
): PayerTypeParse {
  const parsed = parsePayerTypeInput(cell);
  if (!parsed.ok) return parsed;
  const fromName = payerTypeFromPlanName(planName);
  if (parsed.value && fromName && parsed.value !== fromName) {
    return {
      ok: false,
      error: `Payer type ${parsed.value} conflicts with the plan name "${(planName ?? '').trim()}", which says ${fromName}. Fix the row.`,
    };
  }
  return { ok: true, value: parsed.value ?? fromName };
}
