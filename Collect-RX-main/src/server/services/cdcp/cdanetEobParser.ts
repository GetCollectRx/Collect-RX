/**
 * CDAnet Version 4 — Explanation of Benefits (EOB) Parser & Predetermination
 * Packaging
 *
 * Complements cdanetSubmission.ts (which builds outbound Transaction 09
 * attachment payloads): this module parses *inbound* Transaction 11/19
 * adjudication responses, and packages a predetermination's line items into
 * a Version 4 XML payload for outbound submission — gated on
 * preSubmissionAudit.ts's evidence check, so a claim missing required
 * clinical documentation (crown-root ratio films, PSR scores, restorative
 * justification) can never be packaged in the first place.
 *
 * XML is parsed with fast-xml-parser rather than hand-rolled regex — CDAnet
 * V4 payloads carry nested line-item arrays and this codebase's own EOB data
 * determines what a patient is billed, which is not somewhere to accept the
 * fragility of regex-based XML extraction.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { PreSubmissionAuditResult } from './preSubmissionAudit.js';

const CDANET_VERSION = '04';

// ─── Inbound: Transaction 11/19 EOB Parsing ───────────────────────────────────

export interface AdjudicationResult {
  transactionId: string;
  /** e.g. "00" (Approved), "31" (Submit Secondary First), "52" (Rejected). */
  responseCode: string;
  approvedAmountInCents: number;
  unpaidAmountInCents: number;
  rejectionReasons: string[];
}

interface CdanetLineItem {
  SubmittedAmount?: string | number;
  ApprovedAmount?: string | number;
  RejectionReasonCode?: string | number;
}

interface CdanetMessageShape {
  CDAnetMessage?: {
    Header?: { TransactionId?: string };
    Response?: {
      AdjudicationStatus?: string;
      TreatmentLineItems?: { LineItem?: CdanetLineItem | CdanetLineItem[] };
    };
  };
}

// parseTagValue: false is required — CDAnet response codes ("00", "05") and
// rejection reason codes are zero-padded strings; fast-xml-parser's default
// numeric coercion silently strips the leading zero ("00" -> 0 -> "0"),
// which would corrupt a real adjudication status. Money fields are parsed
// explicitly via toCents() below instead of relying on tag-value coercion.
const eobParser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

/** Coerces a CDAnet money cell (string or number, dollars) to integer cents. */
function toCents(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Parses a CDAnet V4 Transaction 11 (EOB) or 19 (adjudication response) XML
 * payload. Throws on a structurally invalid message — callers should treat
 * that as a hard failure requiring manual review, not a claim status.
 */
export function parseEOB(xmlPayload: string): AdjudicationResult {
  const parsed = eobParser.parse(xmlPayload) as CdanetMessageShape;

  const header = parsed.CDAnetMessage?.Header;
  const response = parsed.CDAnetMessage?.Response;

  if (!header?.TransactionId || !response) {
    throw new Error('Invalid CDAnet Version 4 XML structure: missing Header.TransactionId or Response block.');
  }

  const responseCode = response.AdjudicationStatus ?? '52';

  const rawItems = response.TreatmentLineItems?.LineItem;
  const items: CdanetLineItem[] = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];

  let approvedAmountInCents = 0;
  let unpaidAmountInCents = 0;
  const rejectionReasons: string[] = [];

  for (const item of items) {
    const submittedCents = toCents(item.SubmittedAmount);
    const approvedCents = toCents(item.ApprovedAmount);
    approvedAmountInCents += approvedCents;

    const unpaidCents = submittedCents - approvedCents;
    if (unpaidCents > 0) {
      unpaidAmountInCents += unpaidCents;
      if (item.RejectionReasonCode !== undefined) {
        rejectionReasons.push(String(item.RejectionReasonCode));
      }
    }
  }

  return { transactionId: header.TransactionId, responseCode, approvedAmountInCents, unpaidAmountInCents, rejectionReasons };
}

// ─── Outbound: Predetermination Version 4 XML Packaging ──────────────────────

export interface PredeterminationLineItem {
  cdtCode: string;
  /** Submitted fee, in cents — see billingCalculator.ts's cents convention. */
  feeInCents: number;
  audit: PreSubmissionAuditResult;
}

export interface PredeterminationPackagingResult {
  ok: boolean;
  /** Present only when ok is true. */
  xml?: string;
  /** One entry per line item that failed its pre-submission audit. */
  blockedLineItems: Array<{ cdtCode: string; blockingIssues: string[] }>;
}

const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, format: true });

/**
 * Packages a predetermination's line items into a CDAnet Version 4 XML
 * payload, but only when every line item's pre-submission evidence audit
 * passed. This is the enforcement point: a claim with a crown missing its
 * bone-level radiograph, or scaling missing its PSR score, cannot reach the
 * carrier — it comes back with the specific missing items instead.
 */
export function buildPredeterminationPayload(
  claimId: string,
  practiceId: string,
  treatingDentistProviderNumber: string,
  lineItems: PredeterminationLineItem[],
  submittedAt: Date = new Date(),
): PredeterminationPackagingResult {
  const blockedLineItems = lineItems
    .filter((item) => !item.audit.readyToSubmit)
    .map((item) => ({ cdtCode: item.cdtCode, blockingIssues: item.audit.blockingIssues }));

  if (blockedLineItems.length > 0) {
    return { ok: false, blockedLineItems };
  }

  const payload = {
    CDAnetMessage: {
      Header: {
        TransactionId: claimId,
        TransactionType: '01',
        CdanetVersion: CDANET_VERSION,
        SubmittedAt: submittedAt.toISOString(),
        PracticeId: practiceId,
        ProviderNumber: treatingDentistProviderNumber,
      },
      TreatmentLineItems: {
        LineItem: lineItems.map((item) => ({
          ProcedureCode: item.cdtCode,
          SubmittedAmount: (item.feeInCents / 100).toFixed(2),
        })),
      },
    },
  };

  return { ok: true, xml: xmlBuilder.build(payload), blockedLineItems: [] };
}
