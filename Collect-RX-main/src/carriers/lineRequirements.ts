/**
 * What a practice or business must have on file before a call can be placed, by line of business.
 *
 * The PRD keys legal and dispatch rules by line, not by the word "dental". Health lines (dental,
 * physiotherapy and paramedical) are asked for the provider NPI or provincial registration number by
 * carrier phone menus. The adjuster and program lines have no such requirement defined yet: their
 * payer packs have not been researched, so no identifier is demanded until one is.
 */
import type { IndustryType } from '../types/industry-claims.js';

const LINES_REQUIRING_PRACTICE_NPI: ReadonlySet<IndustryType> = new Set<IndustryType>(['DENTAL', 'PARAMEDICAL_PHYSIO']);

export function requiresPracticeNpi(industryType: IndustryType): boolean {
  return LINES_REQUIRING_PRACTICE_NPI.has(industryType);
}
