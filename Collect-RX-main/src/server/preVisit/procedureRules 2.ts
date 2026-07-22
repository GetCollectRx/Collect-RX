/**
 * Pre-visit CDCP predetermination rules.
 *
 * CDCP requires predetermination (pre-authorization) before treatment for a
 * subset of procedure categories. This module is the single source of truth
 * for which CDT codes trigger that requirement.
 */
import type { CarrierId } from '@prisma/client';

interface CdtRange {
  min: number;
  max: number;
}

// D2710–D2799 (crowns and veneers), D6010–D6199 (implants),
// D7210–D7310 (surgical extractions), D5110–D5899 (dentures and partials)
const CDCP_PREDETERMINATION_RANGES: CdtRange[] = [
  { min: 2710, max: 2799 },
  { min: 6010, max: 6199 },
  { min: 7210, max: 7310 },
  { min: 5110, max: 5899 },
];

function parseCdtCodeNumber(cdtCode: string): number | null {
  const match = /^D?(\d{4})$/i.exec(cdtCode.trim());
  if (!match) return null;
  return parseInt(match[1], 10);
}

export function requiresCdcpPredetermination(cdtCode: string): boolean {
  const num = parseCdtCodeNumber(cdtCode);
  if (num === null) return false;
  return CDCP_PREDETERMINATION_RANGES.some((range) => num >= range.min && num <= range.max);
}

// CDCP is administered through Sun Life — no other carrier in CARRIER_CONFIGS
// runs the CDCP program.
export function isCdcpCarrier(carrierId: CarrierId): boolean {
  return carrierId === 'sun_life';
}
