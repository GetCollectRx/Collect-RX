import { prisma } from '../../lib/prisma';
import { VapiWebhookPayload } from '../../vapi/client';
import { TranscriptPersistResult } from './types';

export async function persistTranscriptText(
  vapiCallId: string,
  transcript: string | undefined | null
): Promise<TranscriptPersistResult> {
  try {
    const callAttempt = await prisma.callAttempt.findUnique({
      where: { vapiCallId },
      select: { id: true },
    });

    if (!callAttempt) {
      return {
        callAttemptId: vapiCallId,
        persisted: false,
        error: 'CallAttempt not found',
      };
    }

    // Persist transcript text (null if empty, not empty string)
    const transcriptText = transcript && transcript.trim().length > 0 ? transcript.trim() : null;

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
