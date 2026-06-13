/**
 * Sales Qualifier Vapi Agent
 *
 * A dedicated Vapi agent for outbound qualification calls to ProspectPractice records.
 * This agent is SEPARATE from the AR voice squad — it handles partnership sales, not claims.
 *
 * Call flow (≈3 minutes):
 *   1. Intro: identify as CollectRx, ask for the office manager / owner
 *   2. Qualify: 3 questions about current AR pain, practice size, PMS used
 *   3. CTA: offer to book a demo or send more info
 *   4. End call: capture outcome in tool call → backend records ProspectEvent
 *
 * Outcome values passed back via tool call:
 *   - not_available      : receptionist says DM is unavailable; schedule callback
 *   - not_interested     : explicit rejection
 *   - wants_info         : interested, send email with more details
 *   - demo_booked        : agreed to a demo (booking URL spoken aloud)
 *   - qualified          : expressed interest; hand off to human sales rep
 *   - wrong_number       : number is not a dental practice
 */

export interface SalesQualifierCallConfig {
  prospectId: string;
  practiceName: string;
  city: string | null;
  phone: string;
  pmsGuess: string | null;
}

export interface SalesQualifierAgentConfig {
  name: string;
  model: {
    provider: string;
    model: string;
    systemPrompt: string;
  };
  voice: {
    provider: string;
    voiceId: string;
  };
  firstMessage: string;
  endCallMessage: string;
  tools: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
    server?: { url: string };
  }>;
  phoneNumberId?: string;
  customer: { number: string; name: string };
  metadata: Record<string, string>;
}

function getDemoUrl(): string {
  return process.env.MARKETING_DEMO_URL || 'https://collectrx.ca/demo';
}

function getCallbackUrl(): string {
  return process.env.API_BASE_URL || 'https://api.collectrx.ca';
}

export function buildSalesQualifierConfig(cfg: SalesQualifierCallConfig): SalesQualifierAgentConfig {
  const demoUrl = getDemoUrl();
  const callbackUrl = getCallbackUrl();
  const cityLine = cfg.city ? ` in ${cfg.city}` : '';
  const pmsNote = cfg.pmsGuess && cfg.pmsGuess !== 'unknown'
    ? `The practice is believed to use ${cfg.pmsGuess} as their dental software.`
    : '';

  const systemPrompt = `You are a friendly, professional sales representative for CollectRx — an AI-powered insurance AR automation tool for Canadian dental practices.

You are calling ${cfg.practiceName}${cityLine}. ${pmsNote}

Your goals:
1. Ask for the office manager or practice owner (by name if available).
2. Ask ONE qualifying question: "How does your team currently handle follow-up on outstanding insurance claims?"
3. If they engage, briefly describe the value: CollectRx AI agents call Sun Life, Canada Life, Manulife, and other carriers automatically — saving staff 4–8 hours per week.
4. Offer to book a 20-minute demo: "${demoUrl}"
5. Always be respectful of their time. If they're not interested, thank them graciously and end the call.

Rules:
- Never make claims about guaranteed savings amounts.
- Never pressure. One follow-up at most per call.
- If they ask about pricing, say "pricing depends on practice size and I'd love to cover that in the demo."
- Keep the call under 3 minutes.
- Call the record_outcome tool at the end of every call with the outcome.

Outcome options for record_outcome:
  not_available, not_interested, wants_info, demo_booked, qualified, wrong_number`.trim();

  return {
    name: `Sales_Qualifier_${cfg.prospectId}`,
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      systemPrompt,
    },
    voice: {
      provider: 'playht',
      voiceId: 'jennifer',
    },
    firstMessage: `Hi, this is Sarah calling from CollectRx. I'm hoping to connect with the office manager or practice owner about a quick question regarding your insurance follow-up process. Is now an okay time?`,
    endCallMessage: `Thanks for your time — have a wonderful day!`,
    tools: [
      {
        type: 'function',
        function: {
          name: 'record_outcome',
          description: 'Records the outcome of this qualification call.',
          parameters: {
            type: 'object',
            properties: {
              outcome: {
                type: 'string',
                enum: ['not_available', 'not_interested', 'wants_info', 'demo_booked', 'qualified', 'wrong_number'],
                description: 'The result of this call.',
              },
              notes: {
                type: 'string',
                description: 'Brief free-text notes about the conversation.',
              },
              practiceSize: {
                type: 'string',
                enum: ['solo', 'small_group', 'large_group'],
                description: 'Practice size if mentioned during the call.',
              },
              pmsUsed: {
                type: 'string',
                description: 'Dental software they mentioned using, if any.',
              },
            },
            required: ['outcome'],
          },
        },
        server: {
          url: `${callbackUrl}/api/marketing/voice-outcome`,
        },
      },
    ],
    customer: {
      number: cfg.phone,
      name: cfg.practiceName,
    },
    metadata: {
      prospect_id: cfg.prospectId,
      call_type: 'sales_qualifier',
    },
  };
}

/**
 * Initiates a Vapi call using the Sales Qualifier config.
 * Returns the Vapi call ID on success.
 */
export async function initiateQualificationCall(cfg: SalesQualifierCallConfig): Promise<string> {
  const vapiApiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_SALES_PHONE_NUMBER_ID || process.env.VAPI_PHONE_NUMBER_ID;

  if (!vapiApiKey) throw new Error('VAPI_API_KEY not configured');
  if (!phoneNumberId) throw new Error('VAPI_SALES_PHONE_NUMBER_ID not configured');

  const agentConfig = buildSalesQualifierConfig(cfg);

  const payload = {
    phoneNumberId,
    customer: agentConfig.customer,
    assistant: {
      name: agentConfig.name,
      model: agentConfig.model,
      voice: agentConfig.voice,
      firstMessage: agentConfig.firstMessage,
      endCallMessage: agentConfig.endCallMessage,
      tools: agentConfig.tools,
    },
    metadata: agentConfig.metadata,
  };

  const res = await fetch('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${vapiApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vapi call initiation failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}
