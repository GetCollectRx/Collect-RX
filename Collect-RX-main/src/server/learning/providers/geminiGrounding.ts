import type { ResearchSource } from '../types.js';
import type { ResearchProvider } from './types.js';
import { buildNotebooklmQuery } from './util.js';

function geminiApiKey(): string | null {
  const k =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  return k || null;
}

function groundingChunksToSources(
  chunks: { web?: { uri?: string; title?: string } }[] | undefined,
): ResearchSource[] | undefined {
  if (!chunks?.length) return undefined;
  const out: ResearchSource[] = [];
  for (const ch of chunks) {
    const uri = ch.web?.uri;
    if (!uri) continue;
    out.push({ title: ch.web?.title?.trim() || uri, url: uri });
  }
  return out.length ? out : undefined;
}

export function createGeminiGroundingResearchProvider(): ResearchProvider {
  return {
    name: 'gemini-grounding',
    async research(input) {
      const apiKey = geminiApiKey();
      if (!apiKey) return null;

      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
        const genAI = new GoogleGenerativeAI(apiKey);

        const prompt = [
          'You are a principal engineer + product researcher for CollectRx (Canadian dental insurance A/R SaaS).',
          'Use Google Search grounding when facts may have changed after your knowledge cutoff.',
          'Answer in Markdown: short bullets, clear risks (privacy/PHI, billing), and 3–5 suggested implementation tasks.',
          '',
          buildNotebooklmQuery(input),
        ].join('\n');

        async function run(withSearch: boolean): Promise<{ summary: string; sources?: ResearchSource[] }> {
          const model = genAI.getGenerativeModel(
            withSearch
              ? {
                  model: modelName,
                  tools: [{ googleSearchRetrieval: {} }],
                }
              : { model: modelName },
          );
          const result = await model.generateContent(prompt);
          const summary = result.response.text().trim();
          const grounding = result.response.candidates?.[0]?.groundingMetadata;
          const sources = groundingChunksToSources(grounding?.groundingChunks);
          return { summary, sources };
        }

        try {
          const first = await run(true);
          if (!first.summary) return null;
          return first;
        } catch (err) {
          const msg = (err as Error).message || '';
          if (/tool|googleSearch|Search|grounding|not supported|400/i.test(msg)) {
            const second = await run(false);
            if (!second.summary) return null;
            return second;
          }
          throw err;
        }
      } catch (err) {
        console.warn('[learning] Gemini research failed', (err as Error).message);
        return null;
      }
    },
  };
}
