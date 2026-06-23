/**
 * ITRANS 2.0 migration scaffold.
 *
 * ITRANS 1 retires June 30, 2026. CDAnet traffic must move to ITRANS 2 endpoints
 * before that date. Vendor credentials are issued per practice; this module
 * surfaces readiness state and a "days remaining" countdown for dashboards.
 *
 * Real EDI client wiring lives in the desktop connector / cdanet adapter
 * (out of scope for this file) — here we only capture configuration + status.
 */

export const ITRANS_1_RETIREMENT_ISO = '2026-06-30T23:59:59Z';

export type ItransReadiness =
  | 'unconfigured'
  | 'configured_test_pending'
  | 'configured_test_passed'
  | 'live'
  | 'unknown';

export interface ItransStatus {
  /** Human-friendly state */
  readiness: ItransReadiness;
  /** True once full migration to ITRANS 2 is verified live */
  itrans2Live: boolean;
  /** Remaining days until ITRANS 1 retires (negative = past due) */
  daysUntilItrans1Retires: number;
  retirementDate: string;
  /** Subset of env that drives readiness — never returns secret values */
  config: {
    endpointSet: boolean;
    siteIdSet: boolean;
    softwareIdSet: boolean;
    certificateConfigured: boolean;
    testModeEnabled: boolean;
  };
  /** Surface action needed to operators */
  nextAction: string;
}

function envSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

function deriveReadiness(config: ItransStatus['config']): ItransReadiness {
  const fullyConfigured =
    config.endpointSet &&
    config.siteIdSet &&
    config.softwareIdSet &&
    config.certificateConfigured;
  if (!fullyConfigured) return 'unconfigured';
  if (process.env.ITRANS2_LIVE === '1') return 'live';
  if (config.testModeEnabled) {
    return process.env.ITRANS2_TEST_PASSED === '1'
      ? 'configured_test_passed'
      : 'configured_test_pending';
  }
  return 'unknown';
}

export function getItransStatus(now: Date = new Date()): ItransStatus {
  const config = {
    endpointSet: envSet('ITRANS2_ENDPOINT'),
    siteIdSet: envSet('ITRANS2_SITE_ID'),
    softwareIdSet: envSet('ITRANS2_SOFTWARE_ID'),
    certificateConfigured:
      envSet('ITRANS2_CLIENT_CERT_PATH') || envSet('ITRANS2_CLIENT_CERT_PEM'),
    testModeEnabled: process.env.ITRANS2_TEST_MODE !== '0',
  };
  const readiness = deriveReadiness(config);
  const retirement = new Date(ITRANS_1_RETIREMENT_ISO);
  const daysUntil = Math.ceil(
    (retirement.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  const itrans2Live = readiness === 'live';

  let nextAction: string;
  switch (readiness) {
    case 'unconfigured':
      nextAction =
        'Set ITRANS2_ENDPOINT, ITRANS2_SITE_ID, ITRANS2_SOFTWARE_ID, and certificate (ITRANS2_CLIENT_CERT_PATH or PEM) per practice.';
      break;
    case 'configured_test_pending':
      nextAction =
        'Run ITRANS 2 test transactions; mark ITRANS2_TEST_PASSED=1 once carrier acknowledgments are received.';
      break;
    case 'configured_test_passed':
      nextAction =
        'Test passed. Set ITRANS2_LIVE=1 after switching CDAnet traffic from ITRANS 1 to ITRANS 2.';
      break;
    case 'live':
      nextAction = 'Live on ITRANS 2. Decommission any remaining ITRANS 1 references.';
      break;
    default:
      nextAction = 'Verify ITRANS 2 readiness flags.';
  }

  return {
    readiness,
    itrans2Live,
    daysUntilItrans1Retires: daysUntil,
    retirementDate: retirement.toISOString(),
    config,
    nextAction,
  };
}
