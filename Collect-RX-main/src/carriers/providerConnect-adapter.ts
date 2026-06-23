// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — ProviderConnect Adapter (Canada Life — carrier ID 000011)
//
// Portal-First Dispatch Strategy:
//   Before queuing a Vapi voice call for Canada Life claims, this adapter
//   attempts to retrieve a real-time EOB or claim status via the Canada Life
//   providerConnect web portal. A successful portal lookup eliminates the need
//   for an IVR call entirely, reducing orchestration cost and hold time.
//
// Integration model:
//   Phase 5 pilot: HTTP polling via providerConnect's provider API endpoint
//   (requires a registered provider credential — see PROVIDER_CONNECT_* env vars).
//   If credentials are absent or the portal returns no result, the system falls
//   back to normal Vapi voice dispatch without surfacing an error to the queue.
//
// PHI boundary:
//   Provider number and claim number are non-PHI carrier identifiers.
//   No patient names or DOBs are ever sent to the portal endpoint.
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PortalStatusCode =
  | 'PAID'
  | 'PENDING'
  | 'REJECTED'
  | 'PARTIALLY_PAID'
  | 'PREDETERMINATION_ON_FILE'
  | 'NOT_FOUND'
  | 'PORTAL_UNAVAILABLE';

export interface ProviderConnectResult {
  /** Whether a portal-based status was successfully retrieved */
  portalResolved: boolean;
  /** Null when portalResolved is false */
  statusCode: PortalStatusCode | null;
  /** Raw EOB/remittance data from portal (scrubbed of PHI) */
  eobSummary?: string;
  /** ISO timestamp of portal response */
  fetchedAt: string;
  /**
   * When true, a Vapi call should still be dispatched despite a portal response
   * (e.g. status is PENDING and additional follow-up is warranted).
   */
  requiresVapiFollowUp: boolean;
  /** Human-readable reason for dispatch decision */
  dispatchDecision: string;
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function getProviderConnectCredentials(): {
  providerId: string;
  apiKey: string;
  baseUrl: string;
} | null {
  const providerId = process.env.PROVIDER_CONNECT_PROVIDER_ID;
  const apiKey = process.env.PROVIDER_CONNECT_API_KEY;
  const baseUrl =
    process.env.PROVIDER_CONNECT_BASE_URL ??
    'https://providerconnect.canadalife.com/api/v1';

  if (!providerId || !apiKey) return null;
  return { providerId, apiKey, baseUrl };
}

// ---------------------------------------------------------------------------
// Portal status check
// ---------------------------------------------------------------------------

/**
 * Attempt to resolve claim status via Canada Life's providerConnect portal.
 *
 * Returns a `ProviderConnectResult` regardless of outcome:
 *   - `portalResolved: false` signals fallback to Vapi voice dispatch
 *   - `portalResolved: true, requiresVapiFollowUp: false` means no call needed
 *   - `portalResolved: true, requiresVapiFollowUp: true` means status retrieved
 *     but a call is still warranted (e.g. claim is PENDING with no ETA)
 *
 * @param claimNumber  CDAnet/EDI claim reference number — not PHI
 * @param providerNumber  Practice's CDAnet provider number — not PHI
 */
export async function checkClaimViaProviderConnect(
  claimNumber: string,
  providerNumber: string,
): Promise<ProviderConnectResult> {
  const now = new Date().toISOString();
  const credentials = getProviderConnectCredentials();

  // No credentials configured → skip portal, fall through to Vapi
  if (!credentials) {
    return {
      portalResolved: false,
      statusCode: null,
      fetchedAt: now,
      requiresVapiFollowUp: true,
      dispatchDecision:
        'PROVIDER_CONNECT credentials not configured — falling back to Vapi voice dispatch.',
    };
  }

  try {
    const url = `${credentials.baseUrl}/claims/${encodeURIComponent(claimNumber)}/status`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'X-Provider-Id': credentials.providerId,
        'X-Provider-Number': providerNumber,
        Accept: 'application/json',
        // Data residency: all requests must stay within Canada Central
        'X-Data-Residency': 'Canada-Central',
      },
      signal: AbortSignal.timeout(8_000), // 8 s timeout — don't block queue
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {
          portalResolved: true,
          statusCode: 'NOT_FOUND',
          fetchedAt: now,
          requiresVapiFollowUp: true,
          dispatchDecision:
            'Claim not found on providerConnect portal — dispatching Vapi call for status.',
        };
      }
      // Non-404 error from portal → treat as unavailable, fall back to Vapi
      return {
        portalResolved: false,
        statusCode: 'PORTAL_UNAVAILABLE',
        fetchedAt: now,
        requiresVapiFollowUp: true,
        dispatchDecision: `providerConnect returned HTTP ${response.status} — falling back to Vapi voice dispatch.`,
      };
    }

    const data = (await response.json()) as {
      status?: string;
      eobSummary?: string;
      paidAmount?: number;
      adjudicationDate?: string;
    };

    const rawStatus = (data.status ?? '').toUpperCase();
    const statusCode = mapPortalStatus(rawStatus);

    return {
      portalResolved: true,
      statusCode,
      eobSummary: data.eobSummary,
      fetchedAt: now,
      requiresVapiFollowUp: shouldDispatchAfterPortal(statusCode),
      dispatchDecision: buildDispatchDecision(statusCode, data.adjudicationDate),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      portalResolved: false,
      statusCode: 'PORTAL_UNAVAILABLE',
      fetchedAt: now,
      requiresVapiFollowUp: true,
      dispatchDecision: `providerConnect portal error: ${message} — falling back to Vapi voice dispatch.`,
    };
  }
}

// ---------------------------------------------------------------------------
// Decision helpers
// ---------------------------------------------------------------------------

function mapPortalStatus(raw: string): PortalStatusCode {
  if (raw.includes('PAID') && raw.includes('PARTIAL')) return 'PARTIALLY_PAID';
  if (raw.includes('PAID')) return 'PAID';
  if (raw.includes('PENDING') || raw.includes('IN_PROCESS')) return 'PENDING';
  if (raw.includes('REJECT') || raw.includes('DENIED')) return 'REJECTED';
  if (raw.includes('PREDETERMINATION') || raw.includes('PREDET')) return 'PREDETERMINATION_ON_FILE';
  return 'NOT_FOUND';
}

/**
 * Decide whether a Vapi voice call is still needed after a portal result.
 *
 * - PAID / PARTIALLY_PAID → no call needed (portal gave us the answer)
 * - PREDETERMINATION_ON_FILE → no call needed (predet on file resolves query)
 * - PENDING / REJECTED / NOT_FOUND → call still needed
 * - PORTAL_UNAVAILABLE → fallback to call
 */
function shouldDispatchAfterPortal(status: PortalStatusCode): boolean {
  return status === 'PENDING' ||
    status === 'REJECTED' ||
    status === 'NOT_FOUND' ||
    status === 'PORTAL_UNAVAILABLE';
}

function buildDispatchDecision(
  status: PortalStatusCode,
  adjudicationDate?: string,
): string {
  switch (status) {
    case 'PAID':
      return `Portal confirms PAID${adjudicationDate ? ` (adjudicated ${adjudicationDate})` : ''}. No Vapi call required — update claim to RESOLVED.`;
    case 'PARTIALLY_PAID':
      return `Portal confirms PARTIALLY PAID${adjudicationDate ? ` (adjudicated ${adjudicationDate})` : ''}. No Vapi call required — review EOB for balance.`;
    case 'PREDETERMINATION_ON_FILE':
      return 'PreDetermination EOB found on portal. No Vapi call required.';
    case 'PENDING':
      return 'Portal confirms PENDING with no adjudication date. Dispatching Vapi call for ETA and further status.';
    case 'REJECTED':
      return 'Portal confirms REJECTED. Dispatching Vapi call to gather denial reason for reconsideration.';
    case 'NOT_FOUND':
      return 'Claim not found on portal. Dispatching Vapi call to confirm submission receipt.';
    default:
      return 'Portal unavailable. Dispatching Vapi call as fallback.';
  }
}

// ---------------------------------------------------------------------------
// CallQueue integration helper
//
// Call this from the queue engine BEFORE initiating a Vapi call for
// Canada Life (carrier ID 000011 / carrierId: 'canada_life').
// ---------------------------------------------------------------------------

/**
 * Portal-first dispatch gate for Canada Life claims.
 *
 * Returns:
 *   { proceed: false, reason } — do NOT dispatch Vapi (portal resolved it)
 *   { proceed: true }          — proceed with normal Vapi dispatch
 *
 * @param claimNumber    CDAnet claim reference number
 * @param providerNumber Practice's CDAnet provider number
 */
export async function canadaLifePortalFirstGate(
  claimNumber: string,
  providerNumber: string,
): Promise<{ proceed: boolean; portalResult: ProviderConnectResult }> {
  const portalResult = await checkClaimViaProviderConnect(claimNumber, providerNumber);

  return {
    proceed: portalResult.requiresVapiFollowUp,
    portalResult,
  };
}

export const providerConnectAdapter = {
  checkClaimViaProviderConnect,
  canadaLifePortalFirstGate,
} as const;

export default providerConnectAdapter;
