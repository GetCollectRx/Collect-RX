import type { Prospect } from '@prisma/client';

/**
 * Cold outreach uses standardized templates only (see emailTemplates.ts).
 * Gemini is not used for openers — avoids fabricated social proof.
 * Optional future: light merge-field personalization (practice name, city) inside approved strings.
 */
export function buildStandardOpener(_prospect: Prospect): null {
  return null;
}
