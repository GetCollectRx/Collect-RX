import type {
  PmsImportFamily,
  PmsVendorCatalogEntry,
  PmsVendorId,
} from '../../types/pms.js';
import { PHONE_DECISION_PROFILE } from '../../types/pms.js';

export type { PmsVendorId, PmsImportFamily };
export { PHONE_DECISION_PROFILE };

interface PmsVendorProfile {
  displayName: string;
  importFamily: PmsImportFamily;
  supportsDesktopConnector: boolean;
  supportsEdiVersionGuard: boolean;
}

export const PMS_VENDOR_PROFILES: Record<PmsVendorId, PmsVendorProfile> = {
  abeldent: {
    displayName: 'AbelDent',
    importFamily: 'abeldent',
    supportsDesktopConnector: true,
    supportsEdiVersionGuard: true,
  },
  dentrix: {
    displayName: 'Dentrix',
    importFamily: 'dentrix',
    supportsDesktopConnector: false,
    supportsEdiVersionGuard: false,
  },
  open_dental: {
    displayName: 'Open Dental',
    importFamily: 'generic',
    supportsDesktopConnector: false,
    supportsEdiVersionGuard: false,
  },
  eaglesoft: {
    displayName: 'Eaglesoft',
    importFamily: 'generic',
    supportsDesktopConnector: false,
    supportsEdiVersionGuard: false,
  },
  curve: {
    displayName: 'Curve Dental',
    importFamily: 'generic',
    supportsDesktopConnector: false,
    supportsEdiVersionGuard: false,
  },
  softdent: {
    displayName: 'Softdent',
    importFamily: 'generic',
    supportsDesktopConnector: false,
    supportsEdiVersionGuard: false,
  },
  other: {
    displayName: 'Other / CSV export',
    importFamily: 'generic',
    supportsDesktopConnector: false,
    supportsEdiVersionGuard: false,
  },
};

export const PMS_VENDOR_IDS = Object.keys(PMS_VENDOR_PROFILES) as PmsVendorId[];

/** Legacy import slugs and aliases → canonical vendor id. */
const VENDOR_ALIASES: Record<string, PmsVendorId> = {
  abeldent: 'abeldent',
  abel_dent: 'abeldent',
  dentrix: 'dentrix',
  dentrix_ascend: 'dentrix',
  open_dental: 'open_dental',
  opendental: 'open_dental',
  eaglesoft: 'eaglesoft',
  curve: 'curve',
  softdent: 'softdent',
  other: 'other',
  generic: 'other',
  csv: 'other',
};

export function isPmsVendorId(value: string): value is PmsVendorId {
  return value in PMS_VENDOR_PROFILES;
}

export function normalizePmsVendorId(raw: string | null | undefined): PmsVendorId | null {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
  if (isPmsVendorId(key)) return key;
  return VENDOR_ALIASES[key] ?? null;
}

export function getPmsImportFamily(vendorId: PmsVendorId): PmsImportFamily {
  return PMS_VENDOR_PROFILES[vendorId].importFamily;
}

export function listPmsVendorCatalog(): PmsVendorCatalogEntry[] {
  return PMS_VENDOR_IDS.map((id) => {
    const p = PMS_VENDOR_PROFILES[id];
    return {
      id,
      displayName: p.displayName,
      importFamily: p.importFamily,
      supportsDesktopConnector: p.supportsDesktopConnector,
      supportsEdiVersionGuard: p.supportsEdiVersionGuard,
    };
  });
}

export function vendorDisplayName(vendorId: PmsVendorId): string {
  return PMS_VENDOR_PROFILES[vendorId].displayName;
}
