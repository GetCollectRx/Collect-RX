/**
 * AI Email Personalization
 *
 * Generates a unique, research-backed first paragraph for cold outreach step 1
 * using Gemini. Uses publicly available data about the practice (website, city,
 * Google rating, review count, PMS) to make each email feel hand-crafted.
 *
 * Falls back to the standard template paragraph if Gemini is unavailable or
 * the API call fails — so the email cadence is never blocked by this.
 *
 * Usage:
 *   const para = await personalizeEmailIntro({ practiceName, city, ... })
 *   // inject into step 1 email in place of the generic opening
 */

export interface PersonalizationContext {
  practiceName: string
  city: string | null
  province: string | null
  pmsGuess: string | null
  practiceSize: 'solo' | 'small_group' | 'large_group' | null
  website: string | null
  googleRating?: number
  reviewCount?: number
}

function geminiKey(): string | null {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    null
  )
}

const PERSONALIZE_PROMPT = (ctx: PersonalizationContext) => {
  const location = [ctx.city, ctx.province].filter(Boolean).join(', ')
  const ratingNote =
    ctx.googleRating && ctx.reviewCount
      ? `They have a ${ctx.googleRating}-star rating with ${ctx.reviewCount} reviews — a well-regarded practice.`
      : ''
  const pmsNote = ctx.pmsGuess && ctx.pmsGuess !== 'unknown' ? `They use ${ctx.pmsGuess}.` : ''
  const sizeNote =
    ctx.practiceSize === 'small_group'
      ? 'They appear to be a small group practice.'
      : ctx.practiceSize === 'large_group'
        ? 'They appear to be a larger group practice.'
        : 'They appear to be a solo or small practice.'

  return `
Write a 2-sentence, natural-sounding opening paragraph for a cold sales email to a dental practice about CollectRx — an AI-powered insurance A/R automation service for Canadian dental practices.

Practice details:
- Name: ${ctx.practiceName}
- Location: ${location || 'Canada'}
- ${sizeNote}
- ${pmsNote}
- ${ratingNote}

Requirements:
- Sound like it was written by a real person who did light research — not a template
- Reference something specific about the practice (location, size, or their reputation)
- Bridge naturally to mentioning insurance follow-up as a pain point
- 2 sentences maximum
- Do NOT start with "I" — vary the opening
- Do NOT mention their specific revenue, patient count, or claim you have insider knowledge
- Output ONLY the 2 sentences — no subject line, no greeting, no JSON

Example of good output:
"A colleague mentioned your name when we were discussing practices in the Scarborough area that are growing quickly — which is exactly the type of office CollectRx was built for. If your team is spending any time chasing insurance carriers on the phone, we might be able to give that time back."
`.trim()
}

export async function personalizeEmailIntro(ctx: PersonalizationContext): Promise<string | null> {
  if (!geminiKey()) return null

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(geminiKey()!)
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash' })
    const result = await model.generateContent(PERSONALIZE_PROMPT(ctx))
    const text = result.response.text().trim()

    if (!text || text.length < 30 || text.length > 600) return null
    return text
  } catch (e) {
    console.warn('[aiPersonalization] Gemini error — using standard template', (e as Error).message)
    return null
  }
}
