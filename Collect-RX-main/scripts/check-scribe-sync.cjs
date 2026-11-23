#!/usr/bin/env node
// Compares Claims_Scribe's live Vapi config with the resolver's scenario map (B-12).
// Usage: VAPI_API_KEY=... node scripts/check-scribe-sync.cjs <assistantId>
// Read-only: one GET to the Vapi API. Exits 1 on drift.
const id = process.argv[2];
const key = process.env.VAPI_API_KEY;
if (!id || !key) { console.error('Usage: VAPI_API_KEY=... node scripts/check-scribe-sync.cjs <assistantId>'); process.exit(2); }
(async () => {
  const res = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) { console.error('Vapi request failed:', res.status); process.exit(2); }
  const a = await res.json();
  const prompt = (a.model?.messages || []).map((m) => m.content || '').join('\n');
  const tools = a.model?.tools || [];
  const declared = tools.flatMap((t) => t?.function?.parameters?.properties?.scenario?.enum || []);
  const model = a.model?.model;
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/outcome/humanAssistedOutcomeResolver.ts'), 'utf8');
  const block = src.slice(src.indexOf('const SCENARIO_MAP'));
  const known = [...block.matchAll(/^\s{2}([A-Z_]+):/gm)].map((m) => m[1]);
  const missing = known.filter((k) => !prompt.includes(k));
  const unknown = declared.filter((d) => !known.includes(d));
  console.log(JSON.stringify({ model, missingInPrompt: missing, unknownInTool: unknown }, null, 2));
  if (missing.length || unknown.length) process.exit(1);
})();
