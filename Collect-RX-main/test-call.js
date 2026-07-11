/**
 * CollectRx — Quick Test Script
 *
 * Fires a single Vapi call directly to YOUR phone number
 * using a dummy claim. No database required.
 *
 * Usage:
 *   node test-call.js
 *
 * You will receive a call. The AI agent will roleplay as if
 * it's calling an insurance carrier about the dummy claim.
 * YOU play the carrier — respond naturally to test the flow.
 */

require("dotenv").config();
const axios = require("axios");

// ─── Config ───────────────────────────────────────────────────────────────────
const VAPI_API_KEY       = process.env.VAPI_API_KEY;
const PHONE_NUMBER_ID    = process.env.VAPI_PHONE_NUMBER_ID; // The Vapi number that calls OUT
const YOUR_PHONE         = process.env.TEST_PHONE_NUMBER;    // Your number — gets called
const PRACTICE_NAME      = process.env.VAPI_PRACTICE_NAME || 'CollectRx Demo Practice';
const PRACTICE_ADDRESS   = process.env.VAPI_PRACTICE_ADDRESS || 'test location';
const PRACTICE_PHONE     = process.env.VAPI_PRACTICE_PHONE || '555-0100';

if (!VAPI_API_KEY || !PHONE_NUMBER_ID || !YOUR_PHONE) {
  console.error(`
❌  Missing environment variables. Create a .env file with:

    VAPI_API_KEY=your_vapi_api_key
    VAPI_PHONE_NUMBER_ID=your_vapi_outbound_phone_number_id
    TEST_PHONE_NUMBER=+1XXXXXXXXXX   ← your personal number

  Optional:
    VAPI_PRACTICE_NAME=My Dental Practice        (default: CollectRx Demo Practice)
    VAPI_PRACTICE_ADDRESS=123 Main St, City      (default: test location)
    VAPI_PRACTICE_PHONE=555-0100                 (default: 555-0100)

  `);
  process.exit(1);
}

// ─── Dummy Claim ──────────────────────────────────────────────────────────────
// Swap this out to test different scenarios.
// Set scenario to: 'processing' | 'xray' | 'coverage_maxed' | 'not_covered' | 'resubmit'

const SCENARIO = process.argv[2] || "processing";

const DUMMY_CLAIMS = {
  processing: {
    id: "CLM-001",
    patient_first_name: "James",
    patient_last_name: "Thornton",
    carrier_name: "RBC Insurance",
    policy_number: "RBC-4821-77",
    procedure_code: "D2750",
    procedure_description: "Crown - Porcelain Fused to Metal",
    amount_outstanding: 1250.00,
    days_outstanding: 164,
    submission_date: "2025-09-15",
  },
  xray: {
    id: "CLM-003",
    patient_first_name: "Omar",
    patient_last_name: "Khalil",
    carrier_name: "Manulife Financial",
    policy_number: "MAN-9921-44",
    procedure_code: "D2392",
    procedure_description: "Posterior Composite - 3 Surfaces",
    amount_outstanding: 420.00,
    days_outstanding: 129,
    submission_date: "2025-10-20",
  },
  coverage_maxed: {
    id: "CLM-011",
    patient_first_name: "Thomas",
    patient_last_name: "Bergeron",
    carrier_name: "Canada Life",
    policy_number: "CL-7782-15",
    procedure_code: "D4910",
    procedure_description: "Periodontal Maintenance",
    amount_outstanding: 220.00,
    days_outstanding: 73,
    submission_date: "2025-12-15",
  },
  not_covered: {
    id: "CLM-006",
    patient_first_name: "Maria",
    patient_last_name: "Kowalski",
    carrier_name: "RBC Insurance",
    policy_number: "RBC-2234-56",
    procedure_code: "D6010",
    procedure_description: "Implant - Surgical Placement",
    amount_outstanding: 3200.00,
    days_outstanding: 100,
    submission_date: "2025-11-18",
  },
  resubmit: {
    id: "CLM-029",
    patient_first_name: "Nathan",
    patient_last_name: "Price",
    carrier_name: "RBC Insurance",
    policy_number: "RBC-6612-31",
    procedure_code: "D3330",
    procedure_description: "Root Canal - Molar",
    amount_outstanding: 1100.00,
    days_outstanding: 159,
    submission_date: "2025-09-20",
  },
};

const claim = DUMMY_CLAIMS[SCENARIO];
if (!claim) {
  console.error(`❌ Unknown scenario "${SCENARIO}". Use: processing | xray | coverage_maxed | not_covered | resubmit`);
  process.exit(1);
}

// ─── System Prompt ────────────────────────────────────────────────────────────
const systemPrompt = `You are an AI dental insurance collections agent calling on behalf of ${PRACTICE_NAME}, a dental practice located at ${PRACTICE_ADDRESS}. The practice phone number is ${PRACTICE_PHONE}. Always refer to the practice by name — never by a dentist's name.

You are calling ${claim.carrier_name} provider services to follow up on an outstanding insurance claim.

CLAIM DETAILS:
- Claim ID: ${claim.id}
- Patient: ${claim.patient_first_name} ${claim.patient_last_name}
- Policy Number: ${claim.policy_number}
- Procedure: ${claim.procedure_code} — ${claim.procedure_description}
- Date Submitted: ${claim.submission_date}
- Amount Outstanding: $${claim.amount_outstanding.toFixed(2)}
- Days Outstanding: ${claim.days_outstanding} days

YOUR GOAL:
Find out the current status of this claim and why payment has not been received.

HOW TO START:
Greet naturally and warmly, like a real billing coordinator would. Example: "Hi there, thanks for taking my call. I'm calling from ${PRACTICE_NAME} — we're just following up on a claim we submitted a while back. I've got all the details here whenever you're ready."

SPEECH STYLE — VERY IMPORTANT:
- Speak naturally, like a real person. Use contractions: "I've", "we're", "hasn't", "didn't".
- Add natural filler words occasionally: "Sure", "Of course", "Absolutely", "Got it", "Okay".
- Pause briefly before giving numbers or dates — don't rush them out.
- If you need a moment: "Let me just pull that up..." or "Bear with me one second."
- Don't read from a script. Vary your phrasing each time.
- Never sound like you're reciting a list. Weave information into natural sentences.

WHEN ASKED FOR INFORMATION:
- Claim ID: ${claim.id}
- Policy Number: ${claim.policy_number}
- Provider number: 123456 (test)
- Patient date of birth: January 15, 1980 (test)

HOW TO HANDLE RESPONSES:
- "Still processing" → Ask for expected timeline, thank them, end the call.
- "Payment issued" → Ask for payment date, amount, and reference number.
- "Claim not found / not received" → Ask for correct resubmission method.
- "X-ray or documentation required" → Ask exactly what is needed. Do NOT agree to send anything — note the requirement and end the call politely.
- "Coverage maxed / not covered" → Confirm the reason clearly, thank them, end the call.
- Anything unexpected → Ask for clarification once, note the response, end politely.

IMPORTANT RULES:
- Be professional and concise — this is a business call.
- Do not argue or push back.
- Do not commit to any action — you are only gathering information.
- If you are put on hold for more than 2 minutes, politely end the call.
- Keep the call under 5 minutes.

END OF CALL — output this JSON summary (say it out loud at the very end):
{
  "outcome": "<processing | paid | resubmit_required | xray_required | docs_required | coverage_maxed | not_covered | unknown>",
  "summary": "<one sentence of what the carrier said>",
  "details": "<any specifics: dates, reference numbers, docs needed>",
  "next_action": "<what should happen next>"
}`;

// ─── Fire the Call ────────────────────────────────────────────────────────────
async function runTest() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║           CollectRx — Test Call                      ║
╚══════════════════════════════════════════════════════╝

  Scenario:    ${SCENARIO.toUpperCase()}
  Claim ID:    ${claim.id}
  Patient:     ${claim.patient_first_name} ${claim.patient_last_name}
  Carrier:     ${claim.carrier_name}
  Outstanding: $${claim.amount_outstanding.toFixed(2)} (${claim.days_outstanding} days)
  Calling:     ${YOUR_PHONE}

  👉 When your phone rings, play the role of the insurance carrier.
     Try responding with different answers to test the agent.

  Suggested responses to test:
    • "That claim is still in adjudication, allow 5-10 business days"
    • "We have no record of that claim"  
    • "We need an x-ray before we can process this"
    • "The patient's annual maximum has been reached"
    • "Payment was issued on February 10th"

Initiating call...
  `);

  try {
    const response = await axios.post(
      "https://api.vapi.ai/call/phone",
      {
        assistant: {
          model: {
            provider: "anthropic",
            model: "claude-haiku-4-5-20251001",
            messages: [{ role: "system", content: systemPrompt }],
            temperature: 0.6,
          },
          voice: {
            provider: "11labs",
            voiceId: "EXAVITQu4vr4xnSDxMaL", // "Sarah" — natural, warm, professional North American female
            stability: 0.45,
            similarityBoost: 0.8,
            style: 0.35,
            useSpeakerBoost: true,
          },
          endCallPhrases: ["goodbye", "thank you goodbye", "have a good day", "take care"],
          maxDurationSeconds: 300, // 5 min cap for test calls
        },
        phoneNumberId: PHONE_NUMBER_ID,
        customer: {
          number: YOUR_PHONE,
          name: "Test — " + claim.carrier_name,
        },
        metadata: {
          claim_id: claim.id,
          test: true,
          scenario: SCENARIO,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${VAPI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ Call initiated successfully!`);
    console.log(`   Vapi Call ID: ${response.data?.id}`);
    console.log(`   Your phone should ring within 10-15 seconds.\n`);
    console.log(`   After the call, check your Vapi dashboard → Call Logs`);
    console.log(`   to see the full transcript and the JSON summary output.\n`);

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

runTest();
