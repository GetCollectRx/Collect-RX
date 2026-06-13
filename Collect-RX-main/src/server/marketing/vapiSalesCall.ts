import type { PrismaClient, Prospect } from '@prisma/client';
import type { VapiWebhookPayload } from '../../vapi/client.js';
import {
  buildSalesQualifierFirstMessage,
  buildSalesQualifierSystemPrompt,
  buildSalesQualifierVariableValues,
} from './salesCallScript.js';

export interface InitiateProspectCallResult {
  vapiCallId: string;
  status: string;
}

export async function initiateProspectSalesCall(
  prisma: PrismaClient,
  prospect: Prospect,
): Promise<InitiateProspectCallResult> {
  const apiKey = process.env.VAPI_API_KEY?.trim();
  const assistantId = process.env.VAPI_SALES_ASSISTANT_ID?.trim();
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID?.trim() || process.env.VAPI_PHONE_NUMBER?.trim();

  if (!apiKey) throw new Error('VAPI_API_KEY not configured');
  if (!assistantId) throw new Error('VAPI_SALES_ASSISTANT_ID not configured — set in Vapi dashboard');
  if (!phoneNumberId) throw new Error('VAPI_PHONE_NUMBER_ID not configured');
  if (!prospect.phone) throw new Error('Prospect has no phone number');

  const payload = {
    assistantId,
    phoneNumberId,
    customer: {
      number: normalizePhone(prospect.phone),
      name: prospect.contactName || prospect.practiceName,
    },
    assistantOverrides: {
      firstMessage: buildSalesQualifierFirstMessage(prospect),
      model: {
        messages: [
          {
            role: 'system',
            content: buildSalesQualifierSystemPrompt(prospect),
          },
        ],
      },
      variableValues: buildSalesQualifierVariableValues(prospect),
    },
    metadata: {
      prospectId: prospect.id,
      callType: 'sales_qualifier',
      practiceName: prospect.practiceName,
    },
  };

  const res = await fetch('https://api.vapi.ai/call', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vapi call failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string; status?: string };
  await prisma.prospect.update({
    where: { id: prospect.id },
    data: { lastVapiCallId: data.id },
  });

  return { vapiCallId: data.id, status: data.status || 'queued' };
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}

/** Handle Vapi webhook for sales qualifier calls (no claimId). */
export async function tryProcessProspectVapiWebhook(
  prisma: PrismaClient,
  payload: VapiWebhookPayload,
): Promise<boolean> {
  const meta = payload.metadata as { prospectId?: string; callType?: string } | undefined;
  const prospectId = meta?.prospectId;
  const callType = meta?.callType;
  if (!prospectId || callType !== 'sales_qualifier') return false;

  if (payload.type !== 'call.ended' && payload.type !== 'call.failed') return true;

  const { processProspectCallEnded } = await import('./callSummary.js');
  await processProspectCallEnded(
    prisma,
    prospectId,
    payload.call?.id || '',
    payload.transcript ?? null,
  );
  return true;
}
