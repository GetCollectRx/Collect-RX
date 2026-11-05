import type { ResultConfidence, ResultSource } from '@prisma/client';

export interface ResultProvenanceInput {
  /** A HumanAssistedCallLog existed for this call and drove the outcome. */
  usedHumanLog: boolean;
  /** A schema-validated structured payload from the voice assistant was present. */
  hasStructuredPayload: boolean;
  /** Carrier reference number captured during the call, if any. */
  referenceNumber: string | null;
  /** The financial-terminal gate downgraded the proposed status to ESCALATED. */
  heldForHumanVerification: boolean;
}

export interface ResultProvenance {
  source: ResultSource;
  confidence: ResultConfidence;
}

const MIN_REFERENCE_LENGTH = 4;

/**
 * Derive where a call result came from and how far to trust it. Trust follows
 * the same ordering the financial gate already uses: a human witnessed log is
 * strongest, then a structured payload, then a text classifier. A classifier
 * result is only MEDIUM when a carrier reference number backs it, and any
 * result the gate held for review is LOW regardless of source.
 */
export function deriveResultProvenance(input: ResultProvenanceInput): ResultProvenance {
  const source: ResultSource = input.usedHumanLog
    ? 'HUMAN_LOG'
    : input.hasStructuredPayload
      ? 'STRUCTURED_PAYLOAD'
      : 'TRANSCRIPT_CLASSIFIER';

  if (input.heldForHumanVerification) return { source, confidence: 'LOW' };
  if (source !== 'TRANSCRIPT_CLASSIFIER') return { source, confidence: 'HIGH' };

  const hasReference = (input.referenceNumber ?? '').trim().length >= MIN_REFERENCE_LENGTH;
  return { source, confidence: hasReference ? 'MEDIUM' : 'LOW' };
}
