/**
 * CDAnet Transaction 23 — predetermination / eligibility inquiry (ITRANS 2).
 *
 * When ITRANS2_* env vars are configured, submits a Tx23 inquiry to the
 * practice's CDAnet gateway. Without configuration, returns unresolved so the
 * pre-visit pipeline falls through to VAPI voice dispatch.
 */
import { getItransStatus } from '../canadianExpansion/itrans2.js';

export interface Tx23InquiryParams {
  providerNumber: string;
  memberId: string;
  groupNumber: string;
  procedureCodes: string[];
}

export interface Tx23InquiryResult {
  resolved: boolean;
  eligibilityStatus?: 'eligible' | 'ineligible' | 'unknown';
  predeterminationStatus?: 'approved' | 'denied' | 'pending' | 'unknown';
  reason?: string;
  rawCarrierResponse?: Record<string, unknown>;
}

interface Tx23GatewayResponse {
  eligibilityStatus?: string;
  predeterminationStatus?: string;
  predetStatus?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
}

function normalizeEligibility(raw?: string): Tx23InquiryResult['eligibilityStatus'] {
  const v = (raw ?? '').toLowerCase();
  if (v.includes('ineligible') || v === 'inactive' || v === 'terminated') return 'ineligible';
  if (v.includes('eligible') || v === 'active') return 'eligible';
  return 'unknown';
}

function normalizePredet(raw?: string): Tx23InquiryResult['predeterminationStatus'] {
  const v = (raw ?? '').toLowerCase();
  if (v.includes('denied') || v.includes('reject')) return 'denied';
  if (v.includes('approved') || v.includes('accept')) return 'approved';
  if (v.includes('pending') || v.includes('process')) return 'pending';
  return 'unknown';
}

function gatewayConfigured(): boolean {
  const status = getItransStatus();
  return (
    status.readiness === 'live' ||
    status.readiness === 'configured_test_passed' ||
    status.readiness === 'configured_test_pending'
  );
}

/**
 * Submit a CDAnet Tx23 predetermination inquiry via the ITRANS 2 gateway.
 * Returns `resolved: false` when the gateway is not configured or the inquiry fails.
 */
export async function submitTx23Inquiry(params: Tx23InquiryParams): Promise<Tx23InquiryResult> {
  if (!gatewayConfigured()) {
    return { resolved: false, reason: 'itrans_unconfigured' };
  }

  const endpoint = process.env.ITRANS2_ENDPOINT?.trim();
  if (!endpoint) {
    return { resolved: false, reason: 'itrans_endpoint_missing' };
  }

  const siteId = process.env.ITRANS2_SITE_ID?.trim() ?? '';
  const softwareId = process.env.ITRANS2_SOFTWARE_ID?.trim() ?? '';

  const payload = {
    cdanetVersion: '04',
    itransVersion: '2.0',
    transactionCode: '23',
    siteId,
    softwareId,
    providerNumber: params.providerNumber,
    memberId: params.memberId,
    groupNumber: params.groupNumber,
    procedureCodes: params.procedureCodes,
    testMode: process.env.ITRANS2_LIVE !== '1',
  };

  try {
    const url = endpoint.endsWith('/tx23')
      ? endpoint
      : `${endpoint.replace(/\/$/, '')}/cdanet/tx23`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(siteId ? { 'X-ITRANS-Site-Id': siteId } : {}),
        ...(softwareId ? { 'X-ITRANS-Software-Id': softwareId } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        resolved: false,
        reason: `tx23_http_${response.status}`,
        rawCarrierResponse: { errorMessage: text.slice(0, 500) },
      };
    }

    const data = (await response.json()) as Tx23GatewayResponse;
    if (data.errorCode) {
      return {
        resolved: false,
        reason: `tx23_carrier_${data.errorCode}`,
        rawCarrierResponse: data as Record<string, unknown>,
      };
    }

    const eligibilityStatus = normalizeEligibility(
      data.eligibilityStatus ?? data.status,
    );
    const predeterminationStatus = normalizePredet(
      data.predeterminationStatus ?? data.predetStatus,
    );

    const hasSignal =
      eligibilityStatus !== 'unknown' || predeterminationStatus !== 'unknown';

    if (!hasSignal) {
      return {
        resolved: false,
        reason: 'tx23_no_status',
        rawCarrierResponse: data as Record<string, unknown>,
      };
    }

    return {
      resolved: true,
      eligibilityStatus,
      predeterminationStatus,
      rawCarrierResponse: data as Record<string, unknown>,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { resolved: false, reason: `tx23_error:${message}` };
  }
}
