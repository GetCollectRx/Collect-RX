/**
 * AI Reply Intelligence
 *
 * Processes inbound email replies from prospects (via SendGrid Inbound Parse).
 * Uses Gemini Flash to classify intent and take automated action:
 *
 *   positive      → advance stage to 'engaged', fire hot lead alert
 *   objection     → generate tailored response draft, log as ProspectEvent
 *   unsubscribe   → set optedOutAt, stop sequences
 *   wrong_contact → log, update score down
 *   auto_reply    → ignore (out-of-office etc.)
 *   unknown       → log for human review
 *
 * SendGrid Inbound Parse webhook must be configured to POST to:
 *   POST /api/webhooks/sendgrid-inbound
 *
 * The prospect is identified by the reply-to address or the prospect_id
 * custom header/subject tag we embed in outbound emails.
 */

import type { PrismaClient } from '@prisma/client'
import { fireHotLeadAlert } from './hotLeadAlerts.js'

export type ReplyIntent =
  | 'positive'
  | 'objection'
  | 'unsubscribe'
  | 'wrong_contact'
  | 'auto_reply'
  | 'unknown'

export interface ReplyClassification {
  intent: ReplyIntent
  confidence: number
  objectionType?: string
  suggestedReply?: string
  summary: string
}

function geminiKey(): string | null {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    null
  )
}

const CLASSIFY_PROMPT = (emailBody: string, practiceName: string) => `
You are analyzing an email reply from a dental practice to a cold outreach email about CollectRx — an AI-powered insurance A/R tool for Canadian dental practices.

Practice name: ${practiceName}

Email reply:
"""
${emailBody.slice(0, 2000)}
"""

Classify this reply with JSON only — no other text:
{
  "intent": "positive" | "objection" | "unsubscribe" | "wrong_contact" | "auto_reply" | "unknown",
  "confidence": 0.0-1.0,
  "objectionType": "price" | "timing" | "already_have_solution" | "too_small" | "not_decision_maker" | null,
  "summary": "One sentence summary of what they said",
  "suggestedReply": "If objection: a 2-3 sentence response that directly addresses their concern and keeps the conversation alive. Otherwise null."
}
`.trim()

export async function classifyReply(
  emailBody: string,
  practiceName: string,
): Promise<ReplyClassification> {
  const key = geminiKey()
  if (!key) {
    return { intent: 'unknown', confidence: 0, summary: 'AI not configured', suggestedReply: undefined }
  }

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash' })
    const result = await model.generateContent(CLASSIFY_PROMPT(emailBody, practiceName))
    const text = result.response.text().trim()

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')

    const parsed = JSON.parse(jsonMatch[0]) as ReplyClassification
    return parsed
  } catch (e) {
    console.error('[replyIntelligence] Gemini classify error', (e as Error).message)
    return { intent: 'unknown', confidence: 0, summary: 'Classification failed', suggestedReply: undefined }
  }
}

export interface InboundEmailPayload {
  from: string
  to: string
  subject: string
  text: string
  html?: string
  headers?: string
  /** Custom header X-Prospect-Id set in outbound email headers */
  prospectId?: string
}

export async function processInboundReply(
  prisma: PrismaClient,
  payload: InboundEmailPayload,
): Promise<void> {
  const now = new Date()

  // Identify prospect: first by custom header, then by matching from-email
  let prospect = payload.prospectId
    ? await prisma.prospectPractice.findUnique({ where: { id: payload.prospectId } })
    : null

  if (!prospect && payload.from) {
    const fromEmail = payload.from.match(/<([^>]+)>/)?.[1] || payload.from.split(' ').pop() || ''
    if (fromEmail) {
      prospect = await prisma.prospectPractice.findFirst({
        where: { email: { equals: fromEmail.toLowerCase().trim(), mode: 'insensitive' } },
      })
    }
  }

  if (!prospect) {
    console.info('[replyIntelligence] Received reply but could not match prospect', { from: payload.from })
    return
  }

  const bodyText = payload.text || payload.html?.replace(/<[^>]+>/g, ' ') || ''
  const classification = await classifyReply(bodyText, prospect.name)

  // Log the raw reply event
  await prisma.prospectEvent.create({
    data: {
      prospectId: prospect.id,
      type: 'email_replied',
      metadata: {
        from: payload.from,
        subject: payload.subject,
        intent: classification.intent,
        confidence: classification.confidence,
        objectionType: classification.objectionType ?? null,
        summary: classification.summary,
        suggestedReply: classification.suggestedReply ?? null,
        bodySnippet: bodyText.slice(0, 300),
      },
      occurredAt: now,
    },
  })

  // Act on intent
  switch (classification.intent) {
    case 'positive': {
      await prisma.prospectPractice.update({
        where: { id: prospect.id },
        data: { stage: 'engaged', score: Math.min(100, prospect.score + 20), updatedAt: now },
      })
      // Stop the email cadence — they replied, no more cold emails
      await prisma.prospectSequence.updateMany({
        where: { prospectId: prospect.id, status: 'active' },
        data: { status: 'stopped', completedAt: now, updatedAt: now },
      })
      await fireHotLeadAlert({
        prospectName: prospect.name,
        prospectId: prospect.id,
        city: prospect.city,
        stage: 'engaged',
        score: Math.min(100, prospect.score + 20),
        trigger: 'email_replied',
        detail: classification.summary,
      })
      break
    }

    case 'objection': {
      // Score up slightly (they engaged!) but don't advance stage yet
      await prisma.prospectPractice.update({
        where: { id: prospect.id },
        data: { score: Math.min(100, prospect.score + 5), updatedAt: now },
      })
      // Pause current sequence for 7 days to give human a chance to respond
      if (classification.suggestedReply) {
        await prisma.prospectSequence.updateMany({
          where: { prospectId: prospect.id, status: 'active' },
          data: {
            status: 'paused',
            nextRunAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            updatedAt: now,
          },
        })
      }
      break
    }

    case 'unsubscribe': {
      await prisma.prospectPractice.update({
        where: { id: prospect.id },
        data: { optedOutAt: now, stage: 'not_interested', updatedAt: now },
      })
      await prisma.prospectSequence.updateMany({
        where: { prospectId: prospect.id, status: { in: ['active', 'paused'] } },
        data: { status: 'stopped', completedAt: now, updatedAt: now },
      })
      break
    }

    case 'wrong_contact': {
      await prisma.prospectPractice.update({
        where: { id: prospect.id },
        data: { score: Math.max(0, prospect.score - 15), updatedAt: now },
      })
      break
    }

    case 'auto_reply':
      // Do nothing — out-of-office, no action needed
      break

    default:
      // unknown — logged above, needs human review
      break
  }
}
