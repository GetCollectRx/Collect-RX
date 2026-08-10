#!/usr/bin/env node
/**
 * TELUS AdjudiCare TPA discovery calls — places outbound calls to each TPA's
 * public provider-claims line to confirm it's the right destination before
 * `carrier-configs.json` → telusTpaProfiles is marked VERIFIED.
 *
 * This is a discovery/verification call, not a full IVR-mapping call:
 * the assistant asks one question ("Is this the line providers call to check
 * the status of a submitted dental claim?") and records IVR-vs-live-rep +
 * any useful menu structure, then ends the call cleanly.
 *
 * Isolation from production (src/vapi/client.ts) — same rules as
 * research-call.cjs:
 *   - Uses RESEARCH_VAPI_PHONE_NUMBER_ID and RESEARCH_VAPI_ASSISTANT_ID, never
 *     VAPI_PHONE_NUMBER_ID / VAPI_SQUAD_ID. Never imports or calls initiateCall().
 *   - Sends no metadata, no patientToken, no claimId.
 *   - recordingEnabled is ON so the transcript can be reviewed/classified after.
 *
 * Source doc: "TELUS AdjudiCare — TPA Phone Verification Checklist" (Khalid, 2026-08-01).
 * Numbers below are sourced from TELUS's own provider contact pages — high
 * confidence, unconfirmed by an actual call until this script runs.
 *
 * Usage:
 *   node scripts/ivr-research/telus-tpa-discovery-call.cjs --tpa claimsecure
 *   node scripts/ivr-research/telus-tpa-discovery-call.cjs --all
 *   node scripts/ivr-research/telus-tpa-discovery-call.cjs --list
 *
 * --all places one call per TPA sequentially, waiting CALL_SPACING_MS between
 * dials (default 90s) so calls don't overlap on a single research number.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'research',
  'ivr-validation',
  'telus-tpa-discovery-manifest.json',
);

// Group prefix -> TPA entry. Keys match telusTpaProfiles.group_prefix_ranges
// in src/services/eligibility/rules/carrier-configs.json.
const TELUS_TPA_MAP = {
  A: {
    tpa: 'Alberta Blue Cross',
    phone: '+18005881195',
    hours: 'Mon-Fri 8:30am-5:00pm MT',
  },
  C: {
    tpa: 'ClaimSecure',
    phone: '+18885134464',
    hours: 'Mon-Fri 7:00am-11:00pm',
  },
  D: {
    tpa: 'Desjardins Insurance',
    phone: '+18004637843',
    hours: 'Mon-Fri 8:00am-8:00pm',
  },
  F: {
    tpa: 'First Canadian Benefits',
    phone: '+18662125644',
    hours: 'Mon-Fri 7:30am-6:00pm CST',
  },
  G: {
    tpa: 'GroupHEALTH',
    phone: '+18333446944',
    hours: 'Mon-Thu 7:30am-9:00pm EST, Fri 7:30am-7:00pm EST',
  },
  H: {
    tpa: 'Johnston Group',
    phone: '+18006651234',
    hours: 'not published',
  },
  I: {
    tpa: 'Industrial Alliance',
    phone: '+18774226487',
    hours: 'Mon-Fri 8:00am-8:00pm ET',
  },
  M: {
    tpa: 'Maximum Benefit',
    phone: '+18008937587',
    hours: 'Mon-Fri 7:30am-6:00pm CST',
  },
  P: {
    tpa: 'Pacific Blue Cross',
    phone: '+18663660430',
    hours: 'not published',
  },
  S: {
    tpa: 'SSQ Insurance (now Beneva)',
    phone: '+18882350606',
    hours: 'not published',
  },
  // Exploratory call only — not part of the 10-call verification set.
  // Used to ask TELUS's general line what TPA group prefixes B and E
  // currently route to (see checklist "Separate problem" section).
  TELUS_GENERAL: {
    tpa: 'TELUS AdjudiCare (general line — B/E prefix research only)',
    phone: '+18772893343',
    hours: 'not published',
    question:
      'What TPA does group prefix B currently route to, and what TPA does group prefix E currently route to?',
  },
};

const DEFAULT_QUESTION =
  'Is this the line providers call to check the status of a submitted dental claim?';

const VAPI_BASE_URL = 'https://api.vapi.ai';
const DEFAULT_CALL_SPACING_MS = 90_000;

function parseArgs(argv) {
  const out = { tpa: null, all: false, list: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tpa' && argv[i + 1]) out.tpa = argv[++i];
    else if (a === '--all') out.all = true;
    else if (a === '--list') out.list = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function keyFor(tpaArg) {
  const normalized = tpaArg.trim().toUpperCase();
  if (TELUS_TPA_MAP[normalized]) return normalized;
  // allow matching by TPA name too, e.g. --tpa claimsecure
  const byName = Object.entries(TELUS_TPA_MAP).find(
    ([, v]) => v.tpa.toLowerCase().replace(/[^a-z]/g, '') === tpaArg.toLowerCase().replace(/[^a-z]/g, '')
  );
  return byName ? byName[0] : null;
}

async function placeCall({ key, entry, apiKey, assistantId, phoneNumberId, disclosureName }) {
  const payload = {
    assistantId,
    phoneNumberId,
    customer: { number: entry.phone },
    recordingEnabled: true,
    metadata: { researchCall: true, discoveryCall: true, tpaKey: key, tpaName: entry.tpa },
    variables: {
      carrier_name: entry.tpa,
      disclosure_practice_name: disclosureName,
      verification_question: entry.question || DEFAULT_QUESTION,
    },
  };

  console.log(`Dialing ${entry.tpa} (${entry.phone})...`);
  const res = await fetch(`${VAPI_BASE_URL}/call`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`Vapi call creation failed for ${entry.tpa}: ${res.status} ${text}`);
  }

  const result = await res.json();
  console.log(`  -> call created, Vapi call ID: ${result.id}`);
  return { key, tpa: entry.tpa, phone: entry.phone, callId: result.id };
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || (!args.tpa && !args.all && !args.list)) {
    console.log('Usage:');
    console.log('  node scripts/ivr-research/telus-tpa-discovery-call.cjs --tpa <prefix|name>');
    console.log('  node scripts/ivr-research/telus-tpa-discovery-call.cjs --all');
    console.log('  node scripts/ivr-research/telus-tpa-discovery-call.cjs --list');
    return;
  }

  if (args.list) {
    console.log('TPA keys (group prefix -> TPA):');
    for (const [key, entry] of Object.entries(TELUS_TPA_MAP)) {
      console.log(`  ${key}: ${entry.tpa} (${entry.phone}) — ${entry.hours}`);
    }
    return;
  }

  const apiKey = requireEnv('VAPI_API_KEY');
  const assistantId = requireEnv('RESEARCH_VAPI_ASSISTANT_ID');
  const phoneNumberId = requireEnv('RESEARCH_VAPI_PHONE_NUMBER_ID');
  const disclosureName = process.env.RESEARCH_DISCLOSURE_NAME || 'Northgate Dental, internal test line';
  const spacingMs = Number(process.env.CALL_SPACING_MS) || DEFAULT_CALL_SPACING_MS;

  const results = [];

  if (args.tpa) {
    const key = keyFor(args.tpa);
    if (!key) {
      throw new Error(`Unknown TPA "${args.tpa}". Run with --list to see valid keys.`);
    }
    const r = await placeCall({
      key,
      entry: TELUS_TPA_MAP[key],
      apiKey,
      assistantId,
      phoneNumberId,
      disclosureName,
    });
    results.push(r);
  } else if (args.all) {
    const keys = Object.keys(TELUS_TPA_MAP).filter((k) => k !== 'TELUS_GENERAL');
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const r = await placeCall({
        key,
        entry: TELUS_TPA_MAP[key],
        apiKey,
        assistantId,
        phoneNumberId,
        disclosureName,
      });
      results.push(r);
      if (i < keys.length - 1) {
        console.log(`  waiting ${spacingMs / 1000}s before next call...`);
        await new Promise((resolve) => setTimeout(resolve, spacingMs));
      }
    }
  }

  console.log('\nAll calls placed. Vapi call IDs:');
  for (const r of results) {
    console.log(`  ${r.key} (${r.tpa}): ${r.callId}`);
  }

  // Merge into the manifest so classify-and-draft-config.cjs can find every
  // call placed today, even if --tpa was run multiple times separately.
  let manifest = { calls: [] };
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch {
      manifest = { calls: [] };
    }
  }
  const placedAt = new Date().toISOString();
  for (const r of results) {
    manifest.calls.push({ ...r, placedAt });
  }
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest updated: ${MANIFEST_PATH}`);

  console.log('\nOnce calls end, run:');
  console.log('  node scripts/ivr-research/classify-and-draft-config.cjs');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
