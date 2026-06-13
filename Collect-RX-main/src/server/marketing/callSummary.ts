/**
 * Post-Call AI Summary & Follow-Up Generator
 *
 * After the Sales Qualifier call ends (Vapi tool callback → /api/marketing/voice-outcome),
 * this module:
 *   1. Fetches the call transcript from the Vapi API
 *   2. Runs it through Gemini to produce:
 *      - A 3-sentence call summary
 *      - Extracted facts: practice size, PMS, pain points, objections
 *      - A personalized follow-up email body (if the call was positive)
 *   3. Stores everything in the ProspectEvent metadata
 *   4. Optionally sends the follow-up email immediately
 */

import type { PrismaClient } from '@prisma/client'

interface VapiCallTranscript {
  id: string
  transcript?: string
  messages?: Array<{ role: string; message: string; time?: number }>
  status?: string
  endedAt?: string
  durationSeconds?: number
}

async function fetchVapiTranscript(callId: string): Promise<VapiCallTranscript | null> {
  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(`https://api.vapi.ai/call/${callId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return null
    return (await res.json()) as VapiCallTranscript
  } catch {
    return null
  }
}

function geminiKey(): string | null {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    null
  )
}

const SUMMARY_PROMPT = (
  transcript: string,
  practiceName: string,
  callOutcome: string,
  demoUrl: string,
) => `
You are analyzing a sales qualification call transcript. The call was with ${practiceName}. The recorded outcome was: ${callOutcome}.

Transcript:
"""
${transcript.slice(0, 4000)}
"""

Respond with JSON only:
{
  "summary": "2-3 sentence summary of the conversation",
  "practiceSize": "solo" | "small_group" | "large_group" | null,
  "pmsUsed": "string or null",
  "painPoints": ["array of pain points they mentioned"],
  "objections": ["array of objections or concerns"],
  "interestLevel": "high" | "medium" | "low" | "none",
  "followUpEmail": {
    "subject": "personalized subject line",
    "body": "3-4 paragraph follow-up email referencing specific things they said on the call. Mention their pain points. Include a CTA to book a demo at ${demoUrl}. Do NOT include a salutation or sign-off — just the body paragraphs."
  }
}
`.trim()

export interface CallSummaryResult {
  summary: string
  practiceSize: string | null
  pmsUsed: string | null
  painPoints: string[]
  objections: string[]
  interestLevel: 'high' | 'medium' | 'low' | 'none'
  followUpEmail: { subject: string; body: string } | null
  transcriptLength: number
}

async function generateCallSummary(
  transcript: string,
  practiceName: string,
  callOutcome: string,
): Promise<CallSummaryResult | null> {
  const key = geminiKey()
  if (!key) return null

  const demoUrl = process.env.MARKETING_DEMO_URL || 'https://collectrx.ca/demo'

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash' })
    const result = await model.generateContent(SUMMARY_PROMPT(transcript, practiceName, callOutcome, demoUrl))
    const text = result.response.text().trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as CallSummaryResult
    parsed.transcriptLength = transcript.length
    return parsed
  } catch (e) {
    console.error('[callSummary] Gemini error', (e as Error).message)
    return null
  }
}

function getSendGrid(): null | { send: (msg: object) => Promise<unknown> } {
  if (!process.env.SENDGRID_API_KEY) return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sg = require('@sendgrid/mail')
  sg.setApiKey(process.env.SENDGRID_API_KEY)
  return sg
}

export async function processCallSummary(
  prisma: PrismaClient,
  opts: {
    prospectId: string
    vapiCallId: string
    callOutcome: string
  },
): Promise<CallSummaryResult | null> {
  const prospect = await prisma.prospectPractice.findUnique({ where: { id: opts.prospectId } })
  if (!prospect) return null

  const callData = await fetchVapiTranscript(opts.vapiCallId)
  if (!callData) {
    console.warn('[callSummary] Could not fetch transcript for call', opts.vapiCallId)
    return null
  }

  // Build transcript text from messages array or raw transcript
  let transcriptText = callData.transcript || ''
  if (!transcriptText && callData.messages?.length) {
    transcriptText = callData.messages
      .map((m) => `${m.role === 'assistant' ? 'Agent' : 'Prospect'}: ${m.message}`)
      .join('\n')
  }

  if (!transcriptText) {
    console.warn('[callSummary] Empty transcript for call', opts.vapiCallId)
    return null
  }

  const summary = await generateCallSummary(transcriptText, prospect.name, opts.callOutcome)
  if (!summary) return null

  const now = new Date()

  // Update prospect record with extracted intelligence
  const updates: Record<string, unknown> = { updatedAt: now }
  if (summary.practiceSize && !prospect.practiceSize) {
    updates['practiceSize'] = summary.practiceSize
  }
  if (summary.pmsUsed && !prospect.pmsGuess) {
    updates['pmsGuess'] = summary.pmsUsed
  }
  if (summary.interestLevel === 'high') {
    updates['score'] = Math.min(100, prospect.score + 20)
  } else if (summary.interestLevel === 'medium') {
    updates['score'] = Math.min(100, prospect.score + 10)
  }
  if (Object.keys(updates).length > 1) {
    await prisma.prospectPractice.update({ where: { id: opts.prospectId }, data: updates })
  }

  // Log the summary event
  await prisma.prospectEvent.create({
    data: {
      prospectId: opts.prospectId,
      type: 'call_connected',
      metadata: {
        vapiCallId: opts.vapiCallId,
        outcome: opts.callOutcome,
        summary: summary.summary,
        practiceSize: summary.practiceSize,
        pmsUsed: summary.pmsUsed,
        painPoints: summary.painPoints,
        objections: summary.objections,
        interestLevel: summary.interestLevel,
        durationSeconds: callData.durationSeconds,
        hasFollowUp: !!summary.followUpEmail,
      },
      occurredAt: now,
    },
  })

  // Auto-send follow-up email for positive calls
  const senderName = process.env.MARKETING_SENDER_NAME || 'CollectRx Team'
  const fromEmail = process.env.MARKETING_SENDER_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'noreply@collectrx.ca'

  if (
    summary.followUpEmail &&
    summary.interestLevel !== 'none' &&
    prospect.email &&
    !prospect.optedOutAt
  ) {
    const sg = getSendGrid()
    if (sg) {
      const demoUrl = process.env.MARKETING_DEMO_URL || 'https://collectrx.ca/demo'
      const unsubBase = process.env.PUBLIC_APP_URL || 'https://api.collectrx.ca'
      try {
        await sg.send({
          to: prospect.email,
          from: { email: fromEmail, name: senderName },
          subject: summary.followUpEmail.subject,
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
              <p>Hi,</p>
              ${summary.followUpEmail.body.split('\n\n').map((p) => `<p>${p}</p>`).join('')}
              <p style="margin-top:24px"><a href="${demoUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Book a 20-minute demo →</a></p>
              <p style="margin-top:16px">Best,<br/>${senderName}</p>
              <p style="margin-top:32px;font-size:11px;color:#999"><a href="${unsubBase}/api/public/prospect-unsubscribe?p=${encodeURIComponent(prospect.id)}" style="color:#999">Unsubscribe</a></p>
            </div>
          `,
          customArgs: { prospect_id: prospect.id, email_type: 'post_call_followup' },
        })

        await prisma.prospectEvent.create({
          data: {
            prospectId: opts.prospectId,
            type: 'email_sent',
            metadata: {
              subject: summary.followUpEmail.subject,
              to: prospect.email,
              trigger: 'post_call_ai_followup',
            },
            occurredAt: now,
          },
        })
      } catch (e) {
        console.error('[callSummary] follow-up send error', (e as Error).message)
      }
    }
  }

  return summary
}
