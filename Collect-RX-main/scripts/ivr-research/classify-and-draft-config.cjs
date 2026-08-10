#!/usr/bin/env node
/**
 * Classifies each TELUS TPA discovery call (from the manifest written by
 * telus-tpa-discovery-call.cjs) and:
 *   1. Applies VERIFIED results directly to carrier-configs.json →
 *      telusTpaProfiles.tpa_research_leads.<TPA name>
 *   2. Writes a proposed patch for src/vapi/client.ts (allowlist addition) to
 *      docs/research/ivr-validation/client-ts-allowlist.patch.md — NOT applied
 *      automatically, because it touches the guard that gates real outbound
 *      calls carrying patient PHI. Needs a human look before merging.
 *   3. Writes a Markdown summary (docs/research/ivr-validation/SUMMARY-<date>.md)
 *      for Khalid to review.
 *
 * Requires: VAPI_API_KEY, ANTHROPIC_API_KEY (both already in .env).
 *
 * Usage:
 *   node scripts/ivr-research/classify-and-draft-config.cjs
 *   node scripts/ivr-research/classify-and-draft-config.cjs --dry-run   (no file writes)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(ROOT, 'docs', 'research', 'ivr-validation', 'telus-tpa-discovery-manifest.json');
const CONFIG_PATH = path.join(ROOT, 'src', 'services', 'eligibility', 'rules', 'carrier-configs.json');
const PATCH_PATH = path.join(ROOT, 'docs', 'research', 'ivr-validation', 'client-ts-allowlist.patch.md');
const VAPI_BASE_URL = 'https://api.vapi.ai';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function fetchCall(callId, apiKey) {
  const res = await fetch(`${VAPI_BASE_URL}/call/${callId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Vapi GET /call/${callId} failed: ${res.status}`);
  return res.json();
}

async function classifyTranscript({ tpa, phone, transcript, endedReason }, anthropicKey) {
  const prompt = `You are reviewing the transcript of an automated discovery phone call placed to a Canadian dental insurance TPA (third-party administrator) named "${tpa}" at ${phone}. The calling assistant asked (to an IVR menu or a live rep): "Is this the line providers call to check the status of a submitted dental claim?" (or, for the TELUS general line, asked what TPA group prefixes B and E route to).

Vapi's endedReason for this call: ${endedReason || 'unknown'}

Transcript:
"""
${transcript || '(no transcript available — call may not have connected)'}
"""

Classify this call and respond with ONLY a JSON object, no other text:
{
  "status": "VERIFIED" | "WRONG_DEPT" | "NO_ANSWER" | "UNCLEAR",
  "reachedType": "ivr" | "live_rep" | "voicemail" | "no_connect",
  "menu_notes": "short note on IVR menu path if useful for an IVR_Navigator agent, else empty string",
  "wrong_dept_notes": "if WRONG_DEPT or UNCLEAR, what was actually reached / any transfer info offered, else empty string",
  "prefix_routing_notes": "only for the TELUS general line B/E question — what TPA prefix B and E route to, else empty string"
}

VERIFIED means the transcript shows an explicit or clearly implied "yes, this is the provider claim-status line" from a rep or IVR menu description. Be conservative — if it's ambiguous, use UNCLEAR.`;

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`Anthropic classify failed for ${tpa}: ${res.status} ${text}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return { status: 'UNCLEAR', reachedType: 'unknown', menu_notes: '', wrong_dept_notes: `Classifier output unparseable: ${text}`, prefix_routing_notes: '' };
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`No manifest found at ${MANIFEST_PATH} — run telus-tpa-discovery-call.cjs first.`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!manifest.calls?.length) {
    console.log('Manifest has no calls recorded. Nothing to do.');
    return;
  }

  const vapiKey = requireEnv('VAPI_API_KEY');
  const anthropicKey = requireEnv('ANTHROPIC_API_KEY');

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const telusTpaProfiles = config.carriers.telus_adjudicare.telusTpaProfiles;
  if (!telusTpaProfiles.tpa_research_leads) telusTpaProfiles.tpa_research_leads = {};

  const results = [];
  const verifiedPhonesForPatch = [];

  for (const call of manifest.calls) {
    console.log(`Fetching call ${call.callId} (${call.tpa})...`);
    let callData;
    try {
      callData = await fetchCall(call.callId, vapiKey);
    } catch (err) {
      console.error(`  fetch failed: ${err.message}`);
      results.push({ ...call, status: 'FETCH_FAILED', error: err.message });
      continue;
    }

    const transcript = callData.transcript || callData.artifact?.transcript || '';
    const endedReason = callData.endedReason || '';

    const classification = await classifyTranscript(
      { tpa: call.tpa, phone: call.phone, transcript, endedReason },
      anthropicKey,
    );

    console.log(`  -> ${classification.status} (${classification.reachedType})`);
    results.push({ ...call, ...classification, endedReason });

    if (call.key === 'TELUS_GENERAL') continue; // handled in prefix-routing section of summary, not a TPA lead entry

    const status = classification.status === 'VERIFIED' ? 'VERIFIED' : classification.status;
    telusTpaProfiles.tpa_research_leads[call.tpa] = {
      ...(telusTpaProfiles.tpa_research_leads[call.tpa] || {}),
      status,
      ...(classification.status === 'VERIFIED' ? { verified_provider_phone: call.phone } : {}),
      last_call_id: call.callId,
      last_checked: new Date().toISOString().slice(0, 10),
      notes: classification.menu_notes || classification.wrong_dept_notes || '',
    };

    if (classification.status === 'VERIFIED') {
      verifiedPhonesForPatch.push({ tpa: call.tpa, phone: call.phone });
    }
  }

  if (!dryRun) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    console.log(`\nUpdated ${CONFIG_PATH}`);
  } else {
    console.log('\n[dry-run] Would have updated carrier-configs.json');
  }

  // Draft (do not apply) the client.ts allowlist patch.
  const patchLines = [
    '# Proposed src/vapi/client.ts allowlist patch — NEEDS HUMAN REVIEW',
    '',
    `Generated ${new Date().toISOString()}`,
    '',
    'This is NOT auto-applied. It touches the guard in `initiateCall()` that decides',
    'which numbers CollectRx is allowed to dial with real patient PHI on the line.',
    'Review before merging.',
    '',
    '## 1. Add a TPA phone map near CARRIER_PHONE_MAP (after line ~178):',
    '',
    '```ts',
    'export const TELUS_TPA_VERIFIED_PHONE_MAP: Record<string, string> = {',
    ...verifiedPhonesForPatch.map((v) => `  '${v.tpa}': '${v.phone}',`),
    '};',
    '```',
    '',
    '## 2. Extend the allowlist check in initiateCall() (around line 294-296):',
    '',
    '```ts',
    '  const allowedNumbers = new Set(',
    '    [...Object.values(CARRIER_PHONE_MAP), ...Object.values(TELUS_TPA_VERIFIED_PHONE_MAP)]',
    "      .map((n) => n.replace(/\\D/g, '')),",
    '  );',
    '```',
    '',
    '## 3. Same change in initiatePreVisitCall() around line 409-411 if TPA numbers should be dialable pre-visit too.',
    '',
    verifiedPhonesForPatch.length
      ? `Verified this run: ${verifiedPhonesForPatch.map((v) => v.tpa).join(', ')}`
      : 'No TPAs verified this run — nothing to add yet.',
  ];
  if (!dryRun) {
    fs.mkdirSync(path.dirname(PATCH_PATH), { recursive: true });
    fs.writeFileSync(PATCH_PATH, patchLines.join('\n') + '\n');
    console.log(`Wrote proposed client.ts patch: ${PATCH_PATH}`);
  }

  // Summary
  const summaryLines = [
    `# TELUS TPA Discovery Call Summary — ${new Date().toISOString().slice(0, 10)}`,
    '',
    '| TPA | Phone | Status | Reached | Notes |',
    '|---|---|---|---|---|',
    ...results
      .filter((r) => r.key !== 'TELUS_GENERAL')
      .map((r) => `| ${r.tpa} | ${r.phone} | ${r.status} | ${r.reachedType || '-'} | ${(r.menu_notes || r.wrong_dept_notes || r.error || '').replace(/\|/g, '/')} |`),
    '',
    '## B/E prefix research (TELUS general line)',
    results.find((r) => r.key === 'TELUS_GENERAL')?.prefix_routing_notes || 'Not run this batch.',
    '',
    `carrier-configs.json: ${dryRun ? 'NOT updated (dry-run)' : 'updated'}`,
    `client.ts allowlist: drafted at docs/research/ivr-validation/client-ts-allowlist.patch.md — needs manual review before merge`,
  ];
  const summaryPath = path.join(ROOT, 'docs', 'research', 'ivr-validation', `SUMMARY-${new Date().toISOString().slice(0, 10)}.md`);
  if (!dryRun) {
    fs.writeFileSync(summaryPath, summaryLines.join('\n') + '\n');
    console.log(`Wrote summary: ${summaryPath}`);
  }
  console.log('\n' + summaryLines.join('\n'));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
