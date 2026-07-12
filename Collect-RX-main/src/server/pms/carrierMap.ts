import type { CarrierId } from '@prisma/client';

// Keys are pre-normalized (lowercase, non-alphanumerics collapsed to _) so
// they match the lookup key exactly — space/hyphen forms could never match.
const CARRIER_ALIASES: Record<string, CarrierId> = {
  sun_life: 'sun_life',
  sunlife: 'sun_life',
  sunlife_private: 'sun_life',
  sun_life_financial: 'sun_life',
  canada_life: 'canada_life',
  canadalife: 'canada_life',
  great_west_life: 'canada_life',
  manulife: 'manulife',
  manufacturers_life: 'manulife',
  green_shield: 'green_shield',
  greenshield: 'green_shield',
  green_shield_canada: 'green_shield',
  rbc: 'rbc',
  rbc_insurance: 'rbc',
  telus_adjudicare: 'telus_adjudicare',
  telus: 'telus_adjudicare',
  cdcp: 'sun_life',
  cdcp_sunlife: 'sun_life',
};

/**
 * Returns null when the carrier cannot be identified. Callers must treat null
 * as a hard row failure — a guessed carrier means dialing the wrong insurer
 * and disclosing patient identifiers to a party with no relationship to the
 * claim. Never default.
 */
export function mapToCarrierId(raw: string | null | undefined): CarrierId | null {
  if (!raw?.trim()) return null;
  const key = raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (CARRIER_ALIASES[key]) return CARRIER_ALIASES[key];
  for (const [pattern, id] of Object.entries(CARRIER_ALIASES)) {
    if (key.includes(pattern)) return id;
  }
  return null;
}
