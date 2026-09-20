import type { PrismaClient } from '@prisma/client';
import {
  PERSONA_BUCKETS,
  PERSONA_CONFIDENCE_LEVELS,
  type PersonaBucket,
  type PersonaConfidence,
} from '../../types/partnerships.js';
import { logProspectActivity } from './prospectActivity.js';

export interface PersonaClassificationInput {
  prospectId: string;
  bucket: PersonaBucket;
  confidence: PersonaConfidence;
  reasoning?: string;
}

/**
 * Persists the Outreach Persona Classifier Agent's per-contact decision so it's
 * queryable (search/filter by bucket) and auditable (every run logged, not just
 * the latest), instead of existing only as that run's markdown report.
 */
export async function recordPersonaClassification(
  prisma: PrismaClient,
  input: PersonaClassificationInput,
): Promise<{ prospectId: string; bucket: PersonaBucket; confidence: PersonaConfidence }> {
  if (!PERSONA_BUCKETS.includes(input.bucket)) {
    throw new Error(`Unknown persona bucket: ${input.bucket}`);
  }
  if (!PERSONA_CONFIDENCE_LEVELS.includes(input.confidence)) {
    throw new Error(`Unknown persona confidence: ${input.confidence}`);
  }

  const assignedAt = new Date();

  await prisma.prospect.update({
    where: { id: input.prospectId },
    data: {
      personaBucket: input.bucket,
      personaConfidence: input.confidence,
      personaReasoning: input.reasoning ?? null,
      personaAssignedAt: assignedAt,
    },
  });

  await logProspectActivity(
    prisma,
    input.prospectId,
    'persona_classified',
    `Classified as ${input.bucket} (${input.confidence} confidence)`,
    {
      bucket: input.bucket,
      confidence: input.confidence,
      reasoning: input.reasoning ?? null,
      assignedAt: assignedAt.toISOString(),
    },
  );

  return { prospectId: input.prospectId, bucket: input.bucket, confidence: input.confidence };
}
