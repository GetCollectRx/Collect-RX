import type { CarrierId } from '@prisma/client';

const CARRIER_ALIASES: Record<string, CarrierId> = {
  sun_life: 'sun_life',
  sunlife: 'sun_life',
  sunlife_private: 'sun_life',
  'sun life': 'sun_life',
  'sun life financial': 'sun_life',
  canada_life: 'canada_life',
  'canada life': 'canada_life',
  'great-west life': 'canada_life',
  manulife: 'manulife',
  'manufacturers life': 'manulife',
  green_shield: 'green_shield',
  'green shield': 'green_shield',
  rbc: 'rbc',
  rbc_insurance: 'rbc',
  'rbc insurance': 'rbc',
  telus_adjudicare: 'telus_adjudicare',
  telus: 'telus_adjudicare',
  cdcp: 'sun_life',
  cdcp_sunlife: 'sun_life',
};

export function mapToCarrierId(raw: string | null | undefined): CarrierId {
  if (!raw?.trim()) return 'sun_life';
  const key = raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (CARRIER_ALIASES[key]) return CARRIER_ALIASES[key];
  for (const [pattern, id] of Object.entries(CARRIER_ALIASES)) {
    if (key.includes(pattern.replace(/\s/g, '_'))) return id;
  }
  return 'sun_life';
}
