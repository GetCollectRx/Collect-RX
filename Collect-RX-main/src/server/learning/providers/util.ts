import type { NotionLearningItem } from '../types.js';
import type { ProviderResearchInput } from './types.js';

export function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function toProviderResearchInput(
  item: NotionLearningItem,
  keywords: string[],
): ProviderResearchInput {
  return {
    title: item.title,
    description: item.description,
    phase: item.phase,
    priority: item.priority,
    keywords,
  };
}

export function buildNotebooklmQuery(input: ProviderResearchInput): string {
  const kw = input.keywords.slice(0, 12).join(', ');
  return [
    `CollectRx backlog research (dental practice insurance A/R, Canada).`,
    `Title: ${input.title}`,
    `Phase: ${input.phase} | Priority: ${input.priority}`,
    input.description.trim() ? `Description:\n${input.description.trim()}` : '',
    kw ? `Keywords: ${kw}` : '',
    `Find: current carrier/regulatory context, product patterns, risks, and concrete implementation ideas.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
