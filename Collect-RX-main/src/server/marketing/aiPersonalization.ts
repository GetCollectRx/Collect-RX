import type { Prospect } from '@prisma/client';

/**
 * Cold outreach uses standardized templates only (see emailTemplates.ts).
 * Gemini is not used for openers — avoids fabricated social proof.
 * Merge fields: {{practice}}, {{city}}, {{province}} inside approved template strings.
 */
export function mergeProspectFields(template: string, prospect: Prospect): string {
  return template
    .replace(/\{\{practice\}\}/g, prospect.practiceName)
    .replace(/\{\{city\}\}/g, prospect.city?.trim() || '')
    .replace(/\{\{province\}\}/g, prospect.province?.trim() || '');
}

/** @deprecated Use mergeProspectFields via interpolateSubject — kept for API stability */
export function buildStandardOpener(_prospect: Prospect): null {
  return null;
}
