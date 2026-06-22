#!/usr/bin/env node
/**
 * IVR research call — places a single outbound call to a real carrier claims line
 * using a research-only Vapi phone number, to map the IVR menu tree before any
 * real practice or patient data exists.
 *
 * Isolation from production (src/vapi/client.ts):
 *   - Uses RESEARCH_VAPI_PHONE_NUMBER_ID and RESEARCH_VAPI_ASSISTANT_ID, never
 *     VAPI_PHONE_NUMBER_ID / VAPI_SQUAD_ID. Never imports or calls initiateCall().
 *   - Sends no metadata, no patientToken, no claimId — this call has no claim
 *     behind it and must never be mistaken for a real one downstream.
 *   - recordingEnabled is left ON (no PHI exists in this call), so the
 *     transcript/recording can be reviewed afterward.
 *
 * The carrier phone numbers below are the same public claims-line numbers as
 * CARRIER_PHONE_MAP in src/vapi/client.ts. Keep in sync if a carrier changes
 * their number.
 *
 * Usage:
 *   node scripts/ivr-research/research-call.cjs --carrier sun_life
 *   node scripts/ivr-research/research-call.cjs --list
 */

'use strict';

const CARRIER_PHONE_MAP = {
  sun_life: '+18009619356',
  canada_life: '+18007240222',
  manulife: '+18662122333',
  green_shield: '+18882110644',
  rbc: '+18003613311',
  telus_adjudicare: '+18772893343',
};

const VAPI_BASE_URL = 'https://api.vapi.ai';

function parseArgs(argv) {
  const out = { carrier: null, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--carrier' && argv[i + 1]) out.carrier = argv[++i];
    else if (a === '--list') out.list = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log('Usage: node scripts/ivr-research/research-call.cjs --carrier <carrier_id>');
    console.log(`Carriers: ${Object.keys(CARRIER_PHONE_MAP).join(', ')}`);
    return;
  }

  if (args.list || !args.carrier) {
    console.log('Available carrier IDs:', Object.keys(CARRIER_PHONE_MAP).join(', '));
    if (!args.carrier) return;
  }

  const carrierPhone = CARRIER_PHONE_MAP[args.carrier];
  if (!carrierPhone) {
    throw new Error(`Unknown carrier "${args.carrier}". Run with --list to see valid IDs.`);
  }

  const apiKey = requireEnv('VAPI_API_KEY');
  const assistantId = requireEnv('RESEARCH_VAPI_ASSISTANT_ID');
  const phoneNumberId = requireEnv('RESEARCH_VAPI_PHONE_NUMBER_ID');
  const disclosurePracticeName = process.env.RESEARCH_DISCLOSURE_NAME || 'Northgate Dental, internal test line';

  const payload = {
    assistantId,
    phoneNumberId,
    customer: { number: carrierPhone },
    recordingEnabled: true,
    metadata: { researchCall: true, carrierId: args.carrier },
    variables: {
      carrier_name: args.carrier,
      disclosure_practice_name: disclosurePracticeName,
    },
  };

  console.log(`Dialing ${args.carrier} (${carrierPhone}) as research call...`);
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
    throw new Error(`Vapi call creation failed: ${res.status} ${text}`);
  }

  const result = await res.json();
  console.log('Call created. Vapi call ID:', result.id);
  console.log('Once the call ends, fetch the transcript with:');
  console.log(`  curl -H "Authorization: Bearer $VAPI_API_KEY" ${VAPI_BASE_URL}/call/${result.id}`);
  console.log('Then fill in docs/research/ivr-validation/' + args.carrier + '.md using the template.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
