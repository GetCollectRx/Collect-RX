/**
 * Phase 2 roadmap — CDCP reconsideration exclusions & pre-auth flags (2026 CDCP guide alignment).
 * Exclusion list mirrors Appendix E–style categories referenced in product strategy (cosmetic, certain prosthetics, etc.).
 */

/** Normalize CDT / CA dental codes (4- or 5-digit procedure numbers after D). */
export function normalizeCdtCode(raw: string): string {
  let digits = raw.replace(/^D/i, '').replace(/\D/g, '');
  if (!digits) return raw.trim().toUpperCase();
  if (digits.length > 5) digits = digits.slice(-5);
  const core = digits.length <= 4 ? digits.padStart(4, '0') : digits;
  return `D${core}`;
}

/** MOD-05 — April 1, 2026: desensitization requires CDCP pre-authorization. */
export const CDCP_DESENSITIZATION_PREAUTH_CODES = new Set(['D41301', 'D41302']);

export function requiresCdcpDesensitizationPreauth(cdtCode: string): boolean {
  const n = normalizeCdtCode(cdtCode);
  return CDCP_DESENSITIZATION_PREAUTH_CODES.has(n);
}

/**
 * MOD-01 — Procedures blocked from automated reconsideration workflow (Appendix E–style exclusions).
 * Returns a reason string when excluded.
 */
export function reconsiderationExclusionReason(cdtCode: string): string | null {
  const n = normalizeCdtCode(cdtCode);
  const codeNum = n.replace(/^D/, '');

  // Whitening / bleaching products (common D997x)
  if (/^997/.test(codeNum)) {
    return 'Excluded category: cosmetic whitening (Appendix E–style exclusion).';
  }
  // Veneers — resin/metal/ceramic facing codes often D296x
  if (/^296/.test(codeNum)) {
    return 'Excluded category: veneers / elective esthetic restorations.';
  }
  // Bruxism / night guard appliances
  if (/^994[4-6]/.test(codeNum)) {
    return 'Excluded category: bruxism / occlusal appliance (non-Covered pathway).';
  }
  // Fixed prosthodontics — bridges (typical D62xx–D69xx ranges)
  if (/^6[2-7]/.test(codeNum) && codeNum.length >= 3) {
    return 'Excluded category: fixed prosthodontics / bridge work — not eligible for standard reconsideration path.';
  }

  return null;
}

export const RECONSIDERATION_WINDOW_DAYS = 60;
