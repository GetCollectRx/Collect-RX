/** Practice management system vendor — stored on practice settings and import runs. */
export type PmsVendorId =
  | 'abeldent'
  | 'dentrix'
  | 'open_dental'
  | 'eaglesoft'
  | 'curve'
  | 'softdent'
  | 'other';

/**
 * Column-mapping family for CSV/JSON import only.
 * Phone, queue, and recovery routing never branch on this — see `PHONE_DECISION_PROFILE`.
 */
export type PmsImportFamily = 'abeldent' | 'dentrix' | 'generic';

/** All carrier call / recovery decisions use this profile regardless of PMS vendor. */
export const PHONE_DECISION_PROFILE = 'carrier_recovery_v1' as const;

export type PmsIngestMode = 'csv' | 'desktop_connector' | 'unknown';

export interface PracticePmsInfo {
  vendorId: PmsVendorId;
  displayName: string;
  importFamily: PmsImportFamily;
  ingestMode: PmsIngestMode;
  phoneDecisionProfile: typeof PHONE_DECISION_PROFILE;
  /** True when vendor was inferred from the latest import run, not explicitly configured. */
  inferredFromLastImport: boolean;
}

export interface PmsVendorCatalogEntry {
  id: PmsVendorId;
  displayName: string;
  importFamily: PmsImportFamily;
  supportsDesktopConnector: boolean;
  supportsEdiVersionGuard: boolean;
}
