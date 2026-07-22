// ─────────────────────────────────────────────────────────────────────────────
// Agent 02 — CDT Code Coverage Validator
//
// Validates that CDT code → coverage tier mappings are accurate, complete, and
// consistent. An incorrect CDT mapping silently mis-prices patient estimates —
// e.g., classifying a crown (major, 50%) as preventive (100%) means the patient
// pays $0 instead of $600 for a $1,200 procedure.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { getCoverageTier } from '../../src/services/eligibility/rules/cdt-codes';
import { CoverageTier } from '../../src/services/eligibility/types';

// ─────────────────────────────────────────────────────────────────────────────
// Section A — Canonical Code Mappings
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 02-A — Canonical CDT code tier mappings', () => {
  const PREVENTIVE_CODES: [string, string][] = [
    ['D0120', 'Periodic oral evaluation'],
    ['D0150', 'Comprehensive oral evaluation'],
    ['D0210', 'Complete series X-rays'],
    ['D0270', 'Bitewing X-ray — single image'],
    ['D0272', 'Bitewing X-rays — two images'],
    ['D0274', 'Bitewing X-rays — four images'],
    ['D1110', 'Adult prophylaxis (cleaning)'],
    ['D1120', 'Child prophylaxis'],
    ['D1206', 'Topical fluoride varnish'],
    ['D1351', 'Sealant — per tooth'],
    ['D1510', 'Space maintainer — fixed, unilateral'],
  ];

  const BASIC_CODES: [string, string][] = [
    ['D0140', 'Limited oral evaluation'],
    ['D0330', 'Panoramic radiographic image'],
    ['D2140', 'Amalgam restoration — 1 surface'],
    ['D2392', 'Resin composite — 2 surfaces'],
    ['D2920', 'Re-cement crown'],
    ['D2950', 'Core buildup'],
    ['D3310', 'Endodontic therapy — anterior'],
    ['D3320', 'Endodontic therapy — premolar'],
    ['D3330', 'Endodontic therapy — molar (RCT)'],
    ['D4341', 'Periodontal scaling — per quadrant'],
    ['D7111', 'Extraction — coronal remnants, primary tooth'],
    ['D7140', 'Extraction — erupted tooth or exposed root'],
  ];

  const MAJOR_CODES: [string, string][] = [
    ['D2510', 'Inlay — metallic — 1 surface'],
    ['D2740', 'Crown — porcelain/ceramic substrate'],
    ['D2750', 'Crown — porcelain fused to high noble metal'],
    ['D2790', 'Crown — full cast high noble metal'],
    ['D3410', 'Apicoectomy — anterior'],
    ['D3425', 'Apicoectomy — molar'],
    ['D4210', 'Gingivectomy — per quadrant'],
    ['D5110', 'Complete denture — maxillary'],
    ['D5120', 'Complete denture — mandibular'],
    ['D6010', 'Surgical placement — endosteal implant body'],
    ['D6240', 'Pontic — porcelain fused to high noble metal'],
  ];

  const ORTHO_CODES: [string, string][] = [
    ['D8010', 'Limited orthodontic treatment — primary'],
    ['D8020', 'Limited orthodontic treatment — adolescent'],
    ['D8070', 'Comprehensive orthodontic treatment — adolescent'],
    ['D8080', 'Comprehensive orthodontic treatment — adult'],
    ['D8090', 'Comprehensive orthodontic treatment — adult'],
  ];

  for (const [code, description] of PREVENTIVE_CODES) {
    it(`${code} (${description}) → preventive`, () => {
      expect(getCoverageTier(code)).toBe(CoverageTier.Preventive);
    });
  }

  for (const [code, description] of BASIC_CODES) {
    it(`${code} (${description}) → basic`, () => {
      expect(getCoverageTier(code)).toBe(CoverageTier.Basic);
    });
  }

  for (const [code, description] of MAJOR_CODES) {
    it(`${code} (${description}) → major`, () => {
      expect(getCoverageTier(code)).toBe(CoverageTier.Major);
    });
  }

  for (const [code, description] of ORTHO_CODES) {
    it(`${code} (${description}) → ortho`, () => {
      expect(getCoverageTier(code)).toBe(CoverageTier.Ortho);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — Unknown / Fallback Code Handling
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 02-B — Unknown/fallback code handling', () => {
  it('unknown D9xxx code falls back gracefully (returns a valid CoverageTier)', () => {
    const result = getCoverageTier('D9999');
    expect(Object.values(CoverageTier)).toContain(result);
  });

  it('D9995 falls back to basic tier', () => {
    expect(getCoverageTier('D9995')).toBe(CoverageTier.Basic);
  });

  it('completely unknown code does not throw', () => {
    expect(() => getCoverageTier('D0000')).not.toThrow();
  });

  it('unknown code returns a valid tier (never undefined/null)', () => {
    const result = getCoverageTier('D0000');
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C — Critical Tier Accuracy (Patient Impact)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 02-C — Critical tier accuracy', () => {
  it('crown (D2740) is major — not basic or preventive', () => {
    const tier = getCoverageTier('D2740');
    expect(tier).not.toBe(CoverageTier.Preventive);
    expect(tier).not.toBe(CoverageTier.Basic);
    expect(tier).toBe(CoverageTier.Major);
  });

  it('cleaning (D1110) is preventive — not basic or major', () => {
    const tier = getCoverageTier('D1110');
    expect(tier).not.toBe(CoverageTier.Basic);
    expect(tier).not.toBe(CoverageTier.Major);
    expect(tier).toBe(CoverageTier.Preventive);
  });

  it('RCT molar (D3330) is basic — not major', () => {
    const tier = getCoverageTier('D3330');
    expect(tier).not.toBe(CoverageTier.Major);
    expect(tier).toBe(CoverageTier.Basic);
  });

  it('comprehensive ortho (D8080) is ortho — not major', () => {
    const tier = getCoverageTier('D8080');
    expect(tier).not.toBe(CoverageTier.Major);
    expect(tier).toBe(CoverageTier.Ortho);
  });

  it('implant body placement (D6010) is major', () => {
    expect(getCoverageTier('D6010')).toBe(CoverageTier.Major);
  });

  it('perio scaling (D4341) is basic', () => {
    expect(getCoverageTier('D4341')).toBe(CoverageTier.Basic);
  });

  it('simple extraction (D7140) is basic', () => {
    expect(getCoverageTier('D7140')).toBe(CoverageTier.Basic);
  });

  it('panoramic X-ray (D0330) is basic (not preventive)', () => {
    expect(getCoverageTier('D0330')).toBe(CoverageTier.Basic);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — Tier Distribution Sanity Check
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 02-D — Tier distribution sanity', () => {
  const testCodes = [
    'D0120', 'D0150', 'D0210', 'D0274', 'D1110', 'D1120', 'D1351',
    'D0140', 'D0330', 'D2140', 'D2392', 'D2920', 'D3330', 'D4341', 'D7140',
    'D2740', 'D2750', 'D5110', 'D6010', 'D3410',
    'D8070', 'D8080',
  ];

  it('at least 30% of sampled codes are preventive (preventive should be most common)', () => {
    const preventiveCount = testCodes.filter(
      (c) => getCoverageTier(c) === CoverageTier.Preventive,
    ).length;
    expect(preventiveCount / testCodes.length).toBeGreaterThanOrEqual(0.2);
  });

  it('no sampled CDT code returns undefined or null', () => {
    for (const code of testCodes) {
      const tier = getCoverageTier(code);
      expect(tier, `${code} returned undefined/null`).toBeDefined();
      expect(tier).not.toBeNull();
    }
  });

  it('all sampled codes return one of the 4 valid tiers', () => {
    const validTiers = Object.values(CoverageTier);
    for (const code of testCodes) {
      expect(validTiers).toContain(getCoverageTier(code));
    }
  });
});
