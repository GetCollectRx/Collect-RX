import { prisma } from '../../lib/prisma';
import { VapiWebhookPayload } from '../../vapi/client';
import { TranscriptPersistResult } from './types';
import { piiVault } from '../../pii-vault.js';
import { appendPhiAccessEvent } from '../../server/audit/auditLog.js';
import { redactTranscript } from './transcriptRedaction.js';

export async function persistTranscriptText(
  vapiCallId: string,
  transcript: string | undefined | null
): Promise<TranscriptPersistResult> {
  try {
    const callAttempt = await prisma.callAttempt.findUnique({
      where: { vapiCallId },
      select: {
        id: true,
        claim: { select: { id: true, patientToken: true, practiceId: true } },
      },
    });

    if (!callAttempt) {
      return {
        callAttemptId: vapiCallId,
        persisted: false,
        error: 'CallAttempt not found',
      };
    }

    const rawTranscript = transcript && transcript.trim().length > 0 ? transcript.trim() : null;
    let transcriptText: string | null = rawTranscript;

    if (rawTranscript) {
      let phi = null;
      if (callAttempt.claim) {
        const det = piiVault.detokenize(callAttempt.claim.patientToken, 'transcript-redaction', {
          practiceId: callAttempt.claim.practiceId,
        });
        if (det.success && det.phi) {
          phi = det.phi;
          await appendPhiAccessEvent(prisma, {
            practiceId: callAttempt.claim.practiceId,
            operation: 'detokenize_for_transcript_redaction',
            recordType: 'InsuranceClaim',
            recordId: callAttempt.claim.id,
            purpose: 'transcript_redaction',
          });
        }
        // Token expired/missing: fall through with phi === null — the
        // pattern-only pass in redactTranscript still runs below. Do not
        // block persistence on a vault miss; an unredacted-by-name transcript
        // still gets pattern redaction, which is strictly better than either
        // failing the whole write or skipping redaction silently.
      }
      transcriptText = redactTranscript(rawTranscript, phi);
    }

    await prisma.callAttempt.update({
      where: { id: callAttempt.id },
      data: { transcriptText },
    });

    return {
      callAttemptId: callAttempt.id,
      persisted: true,
    };
  } catch (err) {
    return {
      callAttemptId: vapiCallId,
      persisted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function persistFromVapiPayload(payload: VapiWebhookPayload): Promise<TranscriptPersistResult> {
  return persistTranscriptText(payload.call?.id || '', payload.transcript);
}
