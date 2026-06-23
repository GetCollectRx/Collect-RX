import { learningResearchProvider, type LearningResearchProviderName } from '../config.js'
import { createGeminiGroundingResearchProvider } from './geminiGrounding.js';
import { createNotebooklmResearchProvider } from './notebooklmResearch.js';
import type { ResearchProvider } from './types.js';

function uniqByName(providers: ResearchProvider[]): ResearchProvider[] {
  const seen = new Set<string>();
  const out: ResearchProvider[] = [];
  for (const p of providers) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }
  return out;
}

/**
 * External web research providers. Local codebase scan always runs separately.
 */
export function externalResearchProviders(
  primary: LearningResearchProviderName = learningResearchProvider(),
): ResearchProvider[] {
  const notebook = createNotebooklmResearchProvider();
  const gemini = createGeminiGroundingResearchProvider();

  if (primary === 'local') return [];
  if (primary === 'gemini') return uniqByName([gemini, notebook]);
  return uniqByName([notebook, gemini]);
}
