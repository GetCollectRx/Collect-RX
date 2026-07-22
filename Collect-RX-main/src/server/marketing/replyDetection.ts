import type { PrismaClient, ProspectStage } from '@prisma/client';

export interface ReplyAnalysis {
  prospectId: string;
  isInterested: boolean;
  confidence: number; // 0-100
  signals: string[];
  nextAction: 'schedule_demo' | 'send_video' | 'follow_up' | 'archive';
  reasoning: string;
}

const INTEREST_SIGNALS = {
  // High confidence: explicit interest or demo request
  highConfidence: [
    /let['']?s schedule a (demo|call|meeting)/i,
    /yes,? (let['']?s|let.?s) (do|set up|schedule)/i,
    /send me the (video|demo|information)/i,
    /interested/i,
    /what['']?s the (cost|price|investment)/i,
    /can you (call|reach out)/i,
    /when can (you|we) (meet|call|demo)/i,
    /sounds good/i,
    /let['']?s talk/i,
    /how (do i|can i|would we) get started/i,
    /that sounds helpful/i,
    /we['']?re interested/i,
  ],

  // Medium confidence: qualified questions or soft interest
  mediumConfidence: [
    /how does it (work|function)/i,
    /what carrier(s)?|which carrier/i,
    /how (much|many) (hours|time) (does it|can it) save/i,
    /have you (worked with|integration)/i,
    /similar (software|solution|tool)/i,
    /can you (tell me|explain)/i,
    /what['']?s included/i,
    /more information/i,
    /learn more/i,
    /free trial/i,
  ],

  // Low confidence: non-committal or polite deflection
  lowConfidence: [
    /maybe/i,
    /possibly/i,
    /we['']?ll (see|think about it)/i,
    /not right now/i,
    /interesting/i,
    /thank(s)? for (reaching out|letting us know)/i,
    /we['']?re good|we['']?re all set/i,
  ],

  // Negative signals: likely uninterested or unsubscribe
  negative: [
    /unsubscribe/i,
    /remove|delete|take off/i,
    /stop (emailing|contacting)|don['']?t contact/i,
    /not interested/i,
    /spam/i,
    /wrong (number|person|email)/i,
    /no thanks/i,
    /not for us/i,
  ],
};

export function analyzeReply(replyText: string, prospectName: string): ReplyAnalysis {
  if (!replyText || replyText.trim().length === 0) {
    return {
      prospectId: prospectName,
      isInterested: false,
      confidence: 0,
      signals: [],
      nextAction: 'follow_up',
      reasoning: 'Empty reply - likely auto-responder or accidental send.',
    };
  }

  const signals: string[] = [];
  let confidenceScore = 0;

  // Check for negative signals first
  for (const pattern of INTEREST_SIGNALS.negative) {
    if (pattern.test(replyText)) {
      signals.push(`Negative: ${pattern.source.slice(0, 30)}...`);
      return {
        prospectId: prospectName,
        isInterested: false,
        confidence: 95,
        signals,
        nextAction: 'archive',
        reasoning: 'Practice explicitly unsubscribed or expressed no interest.',
      };
    }
  }

  // Check high confidence signals
  for (const pattern of INTEREST_SIGNALS.highConfidence) {
    if (pattern.test(replyText)) {
      signals.push(`High interest: ${pattern.source.slice(0, 40)}...`);
      confidenceScore += 35;
    }
  }

  // Check medium confidence signals
  for (const pattern of INTEREST_SIGNALS.mediumConfidence) {
    if (pattern.test(replyText)) {
      signals.push(`Qualified question: ${pattern.source.slice(0, 40)}...`);
      confidenceScore += 20;
    }
  }

  // Check low confidence signals
  for (const pattern of INTEREST_SIGNALS.lowConfidence) {
    if (pattern.test(replyText)) {
      signals.push(`Polite deflection: ${pattern.source.slice(0, 40)}...`);
      confidenceScore += 5;
    }
  }

  // Determine if interested based on confidence
  const isInterested = confidenceScore >= 30;
  let nextAction: ReplyAnalysis['nextAction'] = 'follow_up';

  if (confidenceScore >= 60) {
    nextAction = 'schedule_demo';
  } else if (confidenceScore >= 40) {
    nextAction = 'send_video';
  } else if (confidenceScore < 10) {
    nextAction = 'follow_up';
  }

  const reasoning = isInterested
    ? `Strong interest signals detected (confidence: ${confidenceScore}%). Recommend scheduling demo or sending video.`
    : `Weak or no interest signals (confidence: ${confidenceScore}%). Recommend follow-up email or archive.`;

  return {
    prospectId: prospectName,
    isInterested,
    confidence: Math.min(100, confidenceScore),
    signals,
    nextAction,
    reasoning,
  };
}

export async function analyzeAndUpdateProspectFromReply(
  prospectId: string,
  replyText: string,
  prospectName: string,
  prisma: PrismaClient,
): Promise<ReplyAnalysis> {
  const analysis = analyzeReply(replyText, prospectName);

  // Update prospect stage based on analysis
  let newStage: ProspectStage;
  if (analysis.isInterested) {
    if (analysis.nextAction === 'schedule_demo') {
      newStage = 'demo_booked';
    } else {
      newStage = 'engaged';
    }
  } else {
    newStage = 'contacted';
  }

  await prisma.prospect.update({
    where: { id: prospectId },
    data: {
      stage: newStage,
      metadata: {
        replyAnalysis: {
          analyzedAt: new Date().toISOString(),
          isInterested: analysis.isInterested,
          confidence: analysis.confidence,
          nextAction: analysis.nextAction,
          signals: analysis.signals,
          reasoning: analysis.reasoning,
          originalReply: replyText.substring(0, 500), // Store first 500 chars
        },
      },
    },
  });

  return analysis;
}

export async function bulkAnalyzeReplies(
  campaignId: string,
  prisma: PrismaClient,
): Promise<{
  analyzed: number;
  interested: number;
  notInterested: number;
  averageConfidence: number;
}> {
  // This would be called by a background job to analyze all replies in a campaign
  // For now, returns placeholder stats

  const prospects = await prisma.prospect.findMany({
    where: { campaignId },
  });

  let interested = 0;
  let analyzed = 0;
  let totalConfidence = 0;

  for (const prospect of prospects) {
    const metadata = prospect.metadata as Record<string, unknown>;
    const replyAnalysis = metadata?.replyAnalysis as Record<string, unknown>;

    if (replyAnalysis && typeof replyAnalysis.confidence === 'number') {
      analyzed++;
      if (replyAnalysis.isInterested) {
        interested++;
      }
      totalConfidence += replyAnalysis.confidence as number;
    }
  }

  return {
    analyzed,
    interested,
    notInterested: analyzed - interested,
    averageConfidence: analyzed > 0 ? Math.round(totalConfidence / analyzed) : 0,
  };
}
