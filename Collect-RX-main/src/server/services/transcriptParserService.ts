import type { CarrierId, PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger.js';
import Anthropic from '@anthropic-ai/sdk';

export interface ParsedClaimOutcome {
  carrierName: string;
  claimStatus: 'APPROVED' | 'DENIED' | 'HELD_AT_CARRIER' | 'RECONSIDERATION_REQUIRED';
  approvedAmount: number | null;
  remainingPatientResponsibility: number | null;
  nextActionRequired: string;
  ledgerNote: string;
  denialReasonCode?: string;
}

const CARRIER_NAME_MAP: Record<CarrierId, string> = {
  sun_life: 'Sun Life',
  manulife: 'Manulife',
  canada_life: 'Canada Life',
  green_shield: 'Green Shield',
  rbc: 'RBC Insurance',
  telus_adjudicare: 'TELUS AdjudiCare',
};

/**
 * Parse unstructured call transcript using Claude AI to extract structured claim outcomes.
 * This enables automated ledger note generation for the receptionist workflow.
 *
 * @param transcript - Full transcript text from the call
 * @param carrierId - Carrier ID (for context in parsing)
 * @param claimNumber - Claim number (for ledger note formatting)
 * @returns Structured claim outcome with pre-formatted ledger note
 */
export async function parseCallTranscript(
  transcript: string,
  carrierId: CarrierId,
  claimNumber: string,
): Promise<ParsedClaimOutcome> {
  const client = new Anthropic();

  const carrierName = CARRIER_NAME_MAP[carrierId] || carrierId;
  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `You are the CollectRx.ca Core AI Parser. Your job is to analyze unstructured call transcripts between a dental practice representative and an insurance carrier (${carrierName}) and extract the exact operational outcome.

Extract the following data points in structured JSON format:
1. carrierName (string) — "${carrierName}"
2. claimStatus (enum: "APPROVED", "DENIED", "HELD_AT_CARRIER", "RECONSIDERATION_REQUIRED") — infer from agent's report
3. approvedAmount (decimal, default null) — only if explicitly stated as approved/paid
4. remainingPatientResponsibility (decimal, default null) — patient's out-of-pocket if stated
5. nextActionRequired (string) — clear statement of what the practice must do next
6. ledgerNote (string) — a highly condensed, pre-formatted 1-line note matching standard dental PMS ledger restrictions. Format: "[${carrierName}] [${today}] - [Outcome Details] - CollectRx"
7. denialReasonCode (string, optional) — if denial reason code was mentioned

Constraints:
* Never output markdown, explanations, or text outside of the JSON block.
* Preserve absolute precision on financial figures.
* Keep the ledgerNote concise (under 100 characters) and suitable for copy-paste into practice PMS.
* Do NOT make up amounts or reason codes — only extract what was explicitly stated.`;

  const userPrompt = `Analyze this insurance call transcript and extract the claim outcome:

TRANSCRIPT:
---
${transcript}
---

Respond with ONLY a JSON object, no markdown, no explanation.`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 500,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in response');
    }

    const parsed = JSON.parse(textContent.text);

    // Ensure required fields exist
    const outcome: ParsedClaimOutcome = {
      carrierName: parsed.carrierName || carrierName,
      claimStatus: parsed.claimStatus || 'HELD_AT_CARRIER',
      approvedAmount: parsed.approvedAmount ?? null,
      remainingPatientResponsibility: parsed.remainingPatientResponsibility ?? null,
      nextActionRequired: parsed.nextActionRequired || 'Await carrier follow-up',
      ledgerNote: parsed.ledgerNote || `[${carrierName}] ${today} - Claim status pending - CollectRx`,
      denialReasonCode: parsed.denialReasonCode,
    };

    logger.info('[transcript-parser] Successfully parsed call outcome', {
      claimNumber,
      carrierId,
      claimStatus: outcome.claimStatus,
    });

    return outcome;
  } catch (err) {
    logger.error('[transcript-parser] Failed to parse transcript', {
      claimNumber,
      carrierId,
      error: err,
    });

    // Return safe fallback
    return {
      carrierName,
      claimStatus: 'HELD_AT_CARRIER',
      approvedAmount: null,
      remainingPatientResponsibility: null,
      nextActionRequired: 'Manual review needed — transcript parsing failed',
      ledgerNote: `[${carrierName}] ${today} - Awaiting manual review - CollectRx`,
      denialReasonCode: undefined,
    };
  }
}

/**
 * Parse transcript and store the result in the CallAttempt record.
 * This allows the frontend to display the parsed outcome without re-processing.
 */
export async function parseTranscriptAndStore(
  prisma: PrismaClient,
  callAttemptId: string,
  transcript: string,
  carrierId: CarrierId,
  claimNumber: string,
): Promise<ParsedClaimOutcome> {
  const parsed = await parseCallTranscript(transcript, carrierId, claimNumber);

  try {
    await prisma.callAttempt.update({
      where: { id: callAttemptId },
      data: {
        parsedClaimOutcome: JSON.parse(JSON.stringify(parsed)),
      },
    });
  } catch (err) {
    logger.error('[transcript-parser] Failed to store parsed outcome in CallAttempt', {
      callAttemptId,
      error: err,
    });
  }

  return parsed;
}

