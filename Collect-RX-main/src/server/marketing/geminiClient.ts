/** Shared Gemini helper for partnerships marketing AI features. */
export async function runGeminiPrompt(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!key) return null;

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const text = result.response.text()?.trim();
    return text || null;
  } catch (err) {
    console.error('[marketing/gemini]', (err as Error).message);
    return null;
  }
}

/** Parse JSON object from Gemini response (strips markdown fences if present). */
export async function runGeminiJson<T>(prompt: string): Promise<T | null> {
  const raw = await runGeminiPrompt(prompt);
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    console.warn('[marketing/gemini] failed to parse JSON response');
    return null;
  }
}
