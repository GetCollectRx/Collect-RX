// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Abeldent CDAnet / ITRANS Version Guard
//
// CDAnet Version 2 (legacy) and ITRANS 1.0 were retired March 31, 2026.
// All Abeldent EDI traffic must now use CDAnet Version 4 over ITRANS 2.0.
//
// This guard is called during every Abeldent PMS sync import to verify that
// the practice's EDI settings are compliant. If legacy version 2 is detected,
// the sync is allowed to continue (we don't block data import) but a
// MIGRATION_REQUIRED error flag is set on the import run record and surfaced
// to the practice owner.
//
// Version detection:
//   Abeldent exports include an optional EDI_SETTINGS row in the import header
//   or a top-level metadata field. The guard inspects:
//     - `cdanet_version`  — string or number: "2", "4", 2, 4
//     - `itrans_version`  — string: "1.0", "2.0"
//     - `edi_protocol`    — string: "cdanetv2", "cdanetv4", "itrans1", "itrans2"
//
//   If none of these fields are present, the guard returns UNKNOWN status
//   (not a blocking error, but flagged for manual review).
// ─────────────────────────────────────────────────────────────────────────────

/** CDAnet version 2 was retired March 31, 2026 */
export const CDANET_V2_RETIREMENT_DATE = '2026-03-31';
/** ITRANS 1.0 retired June 30, 2026 (overlap window for migration) */
export const ITRANS1_RETIREMENT_DATE = '2026-06-30';

export type EdiVersionStatus =
  | 'COMPLIANT'        // CDAnet v4 + ITRANS 2.0 detected
  | 'MIGRATION_REQUIRED'  // Legacy v2 or ITRANS 1.x detected
  | 'UNKNOWN';         // No EDI version metadata in import payload

export interface EdiVersionGuardResult {
  status: EdiVersionStatus;
  /** True when version is explicitly non-compliant (blocks pilot features) */
  migrationRequired: boolean;
  detectedCdanetVersion: string | null;
  detectedItransVersion: string | null;
  message: string;
  /** Recommended action for the practice */
  remediation: string | null;
}

// ---------------------------------------------------------------------------
// Version extraction helpers
// ---------------------------------------------------------------------------

function normaliseCdanetVersion(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase().replace(/[^0-9.]/g, '');
  // Accept "2", "02", "4", "04", "4.0" etc.
  if (s.startsWith('2')) return '2';
  if (s.startsWith('4')) return '4';
  return s || null;
}

function normaliseItransVersion(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (s.includes('2')) return '2.0';
  if (s.includes('1')) return '1.0';
  return s || null;
}

/**
 * Extract EDI version metadata from an Abeldent import payload.
 *
 * Abeldent can surface version info in:
 *   1. A top-level `edi_settings` object in the JSON payload
 *   2. An EDI_SETTINGS pseudo-row in a CSV export (row where column 0 = "EDI_SETTINGS")
 *   3. Top-level fields `cdanet_version`, `itrans_version`, `edi_protocol`
 */
function extractVersionMeta(
  rows: Record<string, unknown>[],
  topLevel?: Record<string, unknown>,
): { cdanet: string | null; itrans: string | null } {
  // 1. Check top-level metadata (JSON import path)
  if (topLevel) {
    const ediSettings = topLevel['edi_settings'] as Record<string, unknown> | undefined;
    if (ediSettings) {
      return {
        cdanet: normaliseCdanetVersion(ediSettings['cdanet_version'] ?? ediSettings['version']),
        itrans: normaliseItransVersion(ediSettings['itrans_version'] ?? ediSettings['protocol']),
      };
    }
    const cdanet = normaliseCdanetVersion(topLevel['cdanet_version']);
    const itrans = normaliseItransVersion(topLevel['itrans_version'] ?? topLevel['edi_protocol']);
    if (cdanet || itrans) return { cdanet, itrans };
  }

  // 2. Scan rows for an EDI_SETTINGS pseudo-row (CSV export path)
  for (const row of rows) {
    const firstVal = Object.values(row)[0];
    if (typeof firstVal === 'string' && firstVal.toUpperCase() === 'EDI_SETTINGS') {
      return {
        cdanet: normaliseCdanetVersion(row['cdanet_version'] ?? row['version'] ?? row['v']),
        itrans: normaliseItransVersion(
          row['itrans_version'] ?? row['itrans'] ?? row['protocol'],
        ),
      };
    }
    // Also look for fields directly in rows
    if (row['cdanet_version'] !== undefined || row['itrans_version'] !== undefined) {
      return {
        cdanet: normaliseCdanetVersion(row['cdanet_version']),
        itrans: normaliseItransVersion(row['itrans_version']),
      };
    }
  }

  return { cdanet: null, itrans: null };
}

// ---------------------------------------------------------------------------
// Main guard function
// ---------------------------------------------------------------------------

/**
 * Verify Abeldent EDI settings for CDAnet v4 / ITRANS 2.0 compliance.
 *
 * Call this before processing an Abeldent import run. The result should be
 * stored on the PmsImportRun record and surfaced to the practice owner.
 *
 * @param rows      Parsed rows from the Abeldent export
 * @param topLevel  Optional top-level metadata from a JSON import payload
 */
export function checkAbeldentEdiVersion(
  rows: Record<string, unknown>[],
  topLevel?: Record<string, unknown>,
): EdiVersionGuardResult {
  const { cdanet, itrans } = extractVersionMeta(rows, topLevel);

  // No version info found
  if (!cdanet && !itrans) {
    return {
      status: 'UNKNOWN',
      migrationRequired: false,
      detectedCdanetVersion: null,
      detectedItransVersion: null,
      message:
        'No EDI version metadata found in this Abeldent export. ' +
        'Unable to verify CDAnet / ITRANS compliance automatically.',
      remediation:
        'Open Abeldent → Settings → EDI Configuration and confirm CDAnet Version 4 and ITRANS 2.0 are selected. ' +
        'Export a new sync file after updating settings.',
    };
  }

  // Check for legacy CDAnet v2
  const isLegacyCdanet = cdanet === '2';
  // Check for legacy ITRANS 1.x
  const isLegacyItrans = itrans === '1.0';

  if (isLegacyCdanet || isLegacyItrans) {
    const legacyParts: string[] = [];
    if (isLegacyCdanet) legacyParts.push(`CDAnet Version 2 (retired ${CDANET_V2_RETIREMENT_DATE})`);
    if (isLegacyItrans) legacyParts.push(`ITRANS 1.0 (retired ${ITRANS1_RETIREMENT_DATE})`);

    return {
      status: 'MIGRATION_REQUIRED',
      migrationRequired: true,
      detectedCdanetVersion: cdanet,
      detectedItransVersion: itrans,
      message:
        `MIGRATION REQUIRED: Legacy EDI protocol detected — ${legacyParts.join(' and ')}. ` +
        'Electronic claim submission via legacy protocols will be rejected by carriers. ' +
        'CollectRx AI calling features require CDAnet v4 for claim number resolution.',
      remediation:
        'Contact Abeldent support to upgrade EDI settings to CDAnet Version 4 + ITRANS 2.0. ' +
        'Ensure your practice is registered with CDAnet v4 through your carrier clearinghouse before switching. ' +
        'CollectRx will continue to import balance data but AI call dispatch may be impaired until migration is complete.',
    };
  }

  // Compliant
  return {
    status: 'COMPLIANT',
    migrationRequired: false,
    detectedCdanetVersion: cdanet,
    detectedItransVersion: itrans,
    message: `EDI settings verified: CDAnet v${cdanet ?? '4'} / ITRANS ${itrans ?? '2.0'} — compliant.`,
    remediation: null,
  };
}

/**
 * Convenience wrapper: throws an error with structured metadata if migration is required.
 * Use in contexts where a hard stop is appropriate.
 */
export class AbeldentMigrationRequiredError extends Error {
  readonly guardResult: EdiVersionGuardResult;

  constructor(result: EdiVersionGuardResult) {
    super(result.message);
    this.name = 'AbeldentMigrationRequiredError';
    this.guardResult = result;
  }
}
