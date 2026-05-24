import type { ResearchSource } from '../types.js';
import type { ResearchProvider } from './types.js';
import { learningResearchTimeoutMs } from '../config.js';
import { buildNotebooklmQuery } from './util.js';

function mapResearchSources(raw: unknown): ResearchSource[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ResearchSource[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const url =
      (typeof r.url === 'string' && r.url) ||
      (typeof r.uri === 'string' && r.uri) ||
      (typeof r.link === 'string' && r.link);
    const title =
      (typeof r.title === 'string' && r.title.trim()) ||
      (typeof r.name === 'string' && r.name.trim()) ||
      url;
    if (title || url) out.push({ title: title || 'Source', url: url || undefined });
  }
  return out.length ? out : undefined;
}

type NotebookLMClientType = {
  connect: (
    opts?: Record<string, string>,
    clientOpts?: { timeoutMs?: number },
  ) => Promise<{
    research: {
      start: (
        notebookId: string,
        query: string,
        source?: 'web' | 'drive',
        mode?: 'fast' | 'deep',
      ) => Promise<unknown>;
      poll: (notebookId: string) => Promise<{
        status?: string;
        summary?: string;
        sources?: unknown;
        taskId?: string;
      }>;
    };
  }>;
};

export function createNotebooklmResearchProvider(): ResearchProvider {
  return {
    name: 'notebooklm',
    async research(input) {
      const notebookId = process.env.NOTEBOOKLM_NOTEBOOK_ID?.trim();
      if (!notebookId) return null;

      try {
        const mod = (await import('notebooklm-sdk')) as { NotebookLMClient?: NotebookLMClientType };
        const NotebookLMClient = mod.NotebookLMClient;
        if (!NotebookLMClient?.connect) return null;

        const connectOpts: Record<string, string> = {};
        const cookies = process.env.NOTEBOOKLM_COOKIES?.trim();
        const cookiesFile = process.env.NOTEBOOKLM_COOKIES_FILE?.trim();
        if (cookies) connectOpts.cookies = cookies;
        if (cookiesFile) connectOpts.cookiesFile = cookiesFile;

        const timeoutMs = learningResearchTimeoutMs();
        const client = await NotebookLMClient.connect(
          Object.keys(connectOpts).length ? connectOpts : undefined,
          { timeoutMs },
        );

        const query = buildNotebooklmQuery(input);
        const source =
          process.env.NOTEBOOKLM_RESEARCH_SOURCE?.trim().toLowerCase() === 'drive'
            ? 'drive'
            : 'web';
        const mode =
          process.env.NOTEBOOKLM_RESEARCH_MODE?.trim().toLowerCase() === 'deep' ? 'deep' : 'fast';

        await client.research.start(notebookId, query, source, mode);

        const deadline = Date.now() + timeoutMs;
        let result = await client.research.poll(notebookId);
        while (result.status === 'in_progress' && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2500));
          result = await client.research.poll(notebookId);
        }

        if (result.status !== 'completed') {
          console.warn('[learning] NotebookLM research incomplete', result.status);
          return null;
        }

        const summary =
          typeof result.summary === 'string' && result.summary.trim()
            ? result.summary.trim()
            : 'NotebookLM research completed (no summary text returned).';

        return { summary, sources: mapResearchSources(result.sources) };
      } catch (err) {
        console.warn('[learning] NotebookLM research failed', (err as Error).message);
        return null;
      }
    },
  };
}
