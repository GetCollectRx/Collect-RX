/**
 * CollectRx — Live Demo Call (real Claims_Agent, not a stand-in)
 *
 * Fires a call to YOUR phone using the exact Claims_Agent, Escalation_Closer,
 * and Resolution_Closer prompts from vapi-squad-config.json — the same
 * prompts the production squad runs against real carriers. IVR_Navigator and
 * Hold_Sentinel are left out: they're silent/DTMF-only and exist to navigate
 * an automated phone tree, which doesn't apply when a human answers directly.
 *
 * Usage:
 *   TEST_PHONE_NUMBER=+1XXXXXXXXXX node demo-agent-call.js [scenario]
 *
 * You will receive a call and play the role of the insurance carrier rep.
 */

require("dotenv").config();
const axios = require("axios");
const squadConfig = require("./vapi-squad-config.json");

// ─── Config ───────────────────────────────────────────────────────────────────
const VAPI_API_KEY     = process.env.VAPI_API_KEY;
const PHONE_NUMBER_ID  = process.env.VAPI_PHONE_NUMBER_ID;
const YOUR_PHONE       = process.env.TEST_PHONE_NUMBER;
const PRACTICE_NAME    = process.env.VAPI_PRACTICE_NAME || "CollectRx Demo Practice";
const PRACTICE_ADDRESS = process.env.VAPI_PRACTICE_ADDRESS || "test location";
const PRACTICE_PHONE   = process.env.VAPI_PRACTICE_PHONE || "555-0100";

if (!VAPI_API_KEY || !PHONE_NUMBER_ID || !YOUR_PHONE) {
  console.error(`
❌  Missing environment variables. Create a .env file with:

    VAPI_API_KEY=your_vapi_api_key
    VAPI_PHONE_NUMBER_ID=your_vapi_outbound_phone_number_id
    TEST_PHONE_NUMBER=+1XXXXXXXXXX   ← your personal number

  Optional:
    VAPI_PRACTICE_NAME=My Dental Practice
    VAPI_PRACTICE_ADDRESS=123 Main St, City
    VAPI_PRACTICE_PHONE=555-0100

  `);
  process.exit(1);
}

// ─── Pull the real conversational agents out of the production squad config ──
// Skips IVR_Navigator and Hold_Sentinel — they never speak, so there's
// nothing to demo there, and they have no fallback if a human just answers.
function findMember(name) {
  const member = squadConfig.squad.members.find((m) => m.assistant.name === name);
  if (!member) throw new Error(`Squad member "${name}" not found in vapi-squad-config.json`);
  return member;
}

const claimsAgent = findMember("Claims_Agent");
const escalationCloser = findMember("Escalation_Closer");
const resolutionCloser = findMember("Resolution_Closer");

const demoDestinations = claimsAgent.assistantDestinations.filter(
  (d) => d.assistantName === "Escalation_Closer" || d.assistantName === "Resolution_Closer",
);

const demoSquad = {
  name: "CollectRx Demo Squad (Claims_Agent only, no IVR)",
  members: [
    { assistant: claimsAgent.assistant, assistantDestinations: demoDestinations },
    { assistant: escalationCloser.assistant, assistantDestinations: [] },
    { assistant: resolutionCloser.assistant, assistantDestinations: [] },
  ],
};

// ─── Dummy Claim ──────────────────────────────────────────────────────────────
// Set scenario to: 'processing' | 'xray' | 'coverage_maxed' | 'not_covered' | 'resubmit'
const SCENARIO = process.argv[2] || "processing";

const DUMMY_CLAIMS = {
  processing: {
    claimId: "CLM-001",
    claimNumber: "CLM-001",
    patientToken: "demo-patient-001",
    policyNumber: "RBC-4821-77",
    carrierId: "rbc",
    carrierName: "RBC Insurance",
    treatmentDate: "2025-09-08",
    claimSubmittedDate: "2025-09-15",
    treatmentCodes: "D2750",
    billedAmount: 1250.0,
    daysOutstanding: 164,
  },
  xray: {
    claimId: "CLM-003",
    claimNumber: "CLM-003",
    patientToken: "demo-patient-003",
    policyNumber: "MAN-9921-44",
    carrierId: "manulife",
    carrierName: "Manulife Financial",
    treatmentDate: "2025-10-13",
    claimSubmittedDate: "2025-10-20",
    treatmentCodes: "D2392",
    billedAmount: 420.0,
    daysOutstanding: 129,
  },
  coverage_maxed: {
    claimId: "CLM-011",
    claimNumber: "CLM-011",
    patientToken: "demo-patient-011",
    policyNumber: "CL-7782-15",
    carrierId: "canada_life",
    carrierName: "Canada Life",
    treatmentDate: "2025-12-08",
    claimSubmittedDate: "2025-12-15",
    treatmentCodes: "D4910",
    billedAmount: 220.0,
    daysOutstanding: 73,
  },
  not_covered: {
    claimId: "CLM-006",
    claimNumber: "CLM-006",
    patientToken: "demo-patient-006",
    policyNumber: "RBC-2234-56",
    carrierId: "rbc",
    carrierName: "RBC Insurance",
    treatmentDate: "2025-11-11",
    claimSubmittedDate: "2025-11-18",
    treatmentCodes: "D6010",
    billedAmount: 3200.0,
    daysOutstanding: 100,
  },
  resubmit: {
    claimId: "CLM-029",
    claimNumber: "CLM-029",
    patientToken: "demo-patient-029",
    policyNumber: "RBC-6612-31",
    carrierId: "rbc",
    carrierName: "RBC Insurance",
    treatmentDate: "2025-09-13",
    claimSubmittedDate: "2025-09-20",
    treatmentCodes: "D3330",
    billedAmount: 1100.0,
    daysOutstanding: 159,
  },
};

const claim = DUMMY_CLAIMS[SCENARIO];
if (!claim) {
  console.error(`❌ Unknown scenario "${SCENARIO}". Use: processing | xray | coverage_maxed | not_covered | resubmit`);
  process.exit(1);
}

// ─── Variables — same shape as initiateCall() in src/vapi/client.ts ──────────
// Downstream fields (reference_number, rep_name, extracted_outcome, etc.) are
// left unset here exactly as production leaves them unset at dispatch time —
// Vapi resolves those from the live conversation during squad handoff.
const variableValues = {
  patient_name: "Demo Patient",
  patient_dob: "1990-01-15",
  policy_number: claim.policyNumber,
  subscriber_name: "",
  subscriber_dob: "",
  relationship: "self",
  claim_id: claim.claimId,
  patient_token: claim.patientToken,
  insurance_carrier: claim.carrierId,
  claim_number: claim.claimNumber,
  group_number: "",
  treatment_date: claim.treatmentDate,
  claim_submitted_date: claim.claimSubmittedDate,
  days_outstanding: String(claim.daysOutstanding),
  amount_billed: claim.billedAmount.toFixed(2),
  amount_expected: claim.billedAmount.toFixed(2),
  outstanding_amount: claim.billedAmount.toFixed(2),
  treatment_codes: claim.treatmentCodes,
  practice_name: PRACTICE_NAME,
  practice_npi: "",
  practice_tax_id: "",
  practice_address: PRACTICE_ADDRESS,
  provider_number: "123456",
  practice_phone: PRACTICE_PHONE,
  language_preference: "en",
  disclosure_message: `Hello, this is an automated calling system contacting you on behalf of ${PRACTICE_NAME}, a dental practice. You can reach us at ${PRACTICE_PHONE}. We are calling regarding an outstanding insurance claim. If you are a representative at the claims department, please stay on the line.`,
  carrierId: claim.carrierId,
  carrier_ivr_instructions: "",
};

// ─── Fire the Call ────────────────────────────────────────────────────────────
async function runDemo() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║       CollectRx — Live Demo Call (real agent)         ║
╚══════════════════════════════════════════════════════╝

  Scenario:    ${SCENARIO.toUpperCase()}
  Claim ID:    ${claim.claimId}
  Carrier:     ${claim.carrierName}
  Outstanding: $${claim.billedAmount.toFixed(2)} (${claim.daysOutstanding} days)
  Calling:     ${YOUR_PHONE}

  This is the real Claims_Agent → Escalation_Closer / Resolution_Closer
  squad, straight from vapi-squad-config.json. Play the carrier rep.

Initiating call...
  `);

  try {
    const response = await axios.post(
      "https://api.vapi.ai/call",
      {
        squad: demoSquad,
        phoneNumberId: PHONE_NUMBER_ID,
        customer: { number: YOUR_PHONE, name: "Demo — " + claim.carrierName },
        assistantOverrides: {
          artifactPlan: { recordingEnabled: false },
          metadata: { claimId: claim.claimId, carrierId: claim.carrierId, demo: true },
          variableValues,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${VAPI_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log(`✅ Call initiated successfully!`);
    console.log(`   Vapi Call ID: ${response.data?.id}`);
    console.log(`   Your phone should ring within 10-15 seconds.\n`);
  } catch (err) {
    const errMsg = err.response?.data || err.message;
    console.error("❌ Call failed to initiate:");
    console.error(JSON.stringify(errMsg, null, 2));
    console.error("\nCommon issues:");
    console.error("  • VAPI_API_KEY is wrong or expired");
    console.error("  • VAPI_PHONE_NUMBER_ID doesn't exist in your account");
    console.error("  • TEST_PHONE_NUMBER format should be +1XXXXXXXXXX");
  }
}

runDemo();
