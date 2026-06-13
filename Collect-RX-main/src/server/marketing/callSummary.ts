import type { PrismaClient, Prospect } from '@prisma/client';
import { wrapOutreachEmail } from './emailLayout.js';
import { runGeminiJson } from './geminiClient.js';
import { sendHotLeadAlert } from './hotLeadAlerts.js';
import { logProspectActivity } from './prospectActivity.js';
import { sendProspectEmail } from './prospectEmail.js';

interface CallAnalysis {
  summary: string;
  painPoints: string[];
  pmsUsed?: string;
  interestLevel: 'high' | 'medium' | 'low';
  followUpEmail: string;
}

export async function processProspectCallEnded(
  prisma: PrismaClient,
  prospectId: string,
  vapiCallId: string,
  transcript: string | null,
): Promise<void> {
  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect || prospect.optOutAt) return;

  let fullTranscript = transcript?.trim() || '';
  if (!fullTranscript && process.env.VAPI_API_KEY) {
    fullTranscript = await fetchVapiTranscript(vapiCallId);
  }

  const analysis = await analyzeCall(prospect, fullTranscript);

  await prisma.prospect.update({
    where: { id: prospect.id },
    data: {
      callSummary: analysis.summary,
      painPoints: analysis.painPoints,
      pmsHint: analysis.pmsUsed ?? prospect.pmsHint,
      stage: analysis.interestLevel === 'high' ? 'qualified' : prospect.stage === 'new' ? 'contacted' : prospect.stage,
      lastEngagedAt: new Date(),
      lastVapiCallId: vapiCallId,
    },
  });

  await logProspectActivity(prisma, prospect.id, 'call_summary', analysis.summary, {
    painPoints: analysis.painPoints,
    pmsUsed: analysis.pmsUsed,
    interestLevel: analysis.interestLevel,
    vapiCallId,
  });

  if (prospect.email && analysis.followUpEmail) {
    const text = analysis.followUpEmail;
    const html = wrapOutreachEmail({
      bodyHtml: `<div style="font-size:16px;line-height:1.56;">${text.replace(/\n/g, '<br />')}</div>`,
      cta: {
        label: 'Book a short demo',
        href: process.env.MARKETING_DEMO_LINK || 'https://www.collectrx.ca/#early-access',
      },
    });
    await sendProspectEmail(
      prospect,
      {
        subject: `Following up, ${prospect.practiceName} and CollectRx`,
        html,
        text,
        activityType: 'call_follow_up_email',
      },
      prisma,
    );
  }

  const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
  if (updated.stage === 'qualified') {
    await sendHotLeadAlert(updated, 'qualified_call', analysis.summary);
  }
}

async function fetchVapiTranscript(vapiCallId: string): Promise<string> {
  try {
    const res = await fetch(`https://api.vapi.ai/call/${vapiCallId}`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { transcript?: string };
    return data.transcript?.trim() || '';
  } catch {
    return '';
  }
}

async function analyzeCall(prospect: Prospect, transcript: string): Promise<CallAnalysis> {
  const prompt = `Analyze this sales qualification call transcript for CollectRx (dental insurance AR automation, helps practices collect outstanding insurance revenue with less staff time on carrier follow-up).
Practice: ${prospect.practiceName}

Rules for followUpEmail:
- Plain, direct B2B tone. No em dashes. No AI filler phrases.
- Do NOT claim we already work with other offices in their city or region
- Do NOT invent statistics or case studies
- Insurance AR only, not patient balances
- Focus on what CollectRx does: automated carrier follow-up, denial visibility, PMS export start, less staff phone time
- Professional, concise, 3-5 sentences

Transcript:
"""
${transcript.slice(0, 8000) || 'Brief intro call. Prospect asked about reducing staff time on insurance follow-up.'}
"""

Return JSON only:
{
  "summary": "2-3 sentence CRM summary",
  "painPoints": ["string"],
  "pmsUsed": "AbelDent|Dentrix|unknown or null",
  "interestLevel": "high" | "medium" | "low",
  "followUpEmail": "plain-text follow-up email body"
}`;

  const parsed = await runGeminiJson<CallAnalysis>(prompt);
  if (parsed?.summary && parsed.followUpEmail) {
    return {
      ...parsed,
      painPoints: parsed.painPoints ?? [],
    };
  }

  const fallbackFollowUp = `Thanks for taking my call earlier.

CollectRx helps dental offices collect outstanding insurance AR with less staff time on carrier follow-up. Automated calls to major Canadian insurers, clear visibility on denials and delays, and a simple start from your PMS export.

Reply if you would like a short demo.`;

  return {
    summary: `Call with ${prospect.practiceName}: discussed reducing staff time on insurance AR follow-up.`,
    painPoints: ['Staff time on carrier follow-up'],
    interestLevel: 'medium',
    followUpEmail: fallbackFollowUp,
  };
}
