import type { ResearchSource } from '../types.js';

export interface ProviderResearchInput {
  title: string;
  description: string;
  phase: string;
  priority: string;
  keywords: string[];
}

export interface ProviderResearchOutput {
  summary: string;
  sources?: ResearchSource[];
}

export interface ResearchProvider {
  /** Stable identifier persisted on `LearningCandidate.researchNotes.provider`. */
  name: string;
  /**
   * Returns null when the provider is not configured (missing creds / module).
   * Throws only on hard failures so the orchestrator can fall through.
   */
  research(input: ProviderResearchInput): Promise<ProviderResearchOutput | null>;
}
