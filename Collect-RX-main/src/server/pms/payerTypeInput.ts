import type { PayerType } from '@prisma/client';

/**
 * Payer program labels accepted in an import column or a file-level
 * declaration. Anything not recognized is rejected rather than guessed: a
 * wrong program would route a claim to (or away from) carrier calls.
 */
const ALIASES: Readonly<Record<string, PayerType>> = {
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
  | { ok: true; value: PayerType | null }
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
