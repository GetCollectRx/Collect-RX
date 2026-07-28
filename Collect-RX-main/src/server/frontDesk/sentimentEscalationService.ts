/**
 * Real-time sentiment analysis → escalation trigger
 * Detects caller frustration patterns in call transcripts and flags for human escalation.
 */

import type { PrismaClient } from '@prisma/client';

export interface SentimentSignal {
  callId: string;
  distressScore: number; // 0-100
  isEscalationTriggered: boolean;
  markers: string[];
  recommendation: 'continue' | 'escalate_now' | 'escalate_after_current_goal';
}

const DISTRESS_MARKERS = [
  'this is ridiculous',
  'this is unacceptable',
  'what the',
  "i can't believe",
  "you're not helping",
  'waste of time',
  'frustrated',
  'angry',
  'upset',
  'helpless',
  "i don't know",
  'figure it out',
];

const FRUSTRATION_ESCALATORS = [
  'repeat',
  'again',
  'third time',
  'fourth time',
  'fifth time',
  'loop',
  'nowhere',
  'dead end',
  'transferred',
];

export function analyzeSentiment(transcript: string): SentimentSignal {
  if (!transcript || transcript.length < 50) {
    return {
      callId: '',
      distressScore: 0,
      isEscalationTriggered: false,
      markers: [],
      recommendation: 'continue',
    };
  }

  const lowerText = transcript.toLowerCase();
  const lines = transcript.split('\n');

  let score = 0;
  const markers: string[] = [];

  for (const marker of DISTRESS_MARKERS) {
    if (lowerText.includes(marker)) {
      score += 15;
      markers.push(marker);
    }
  }

  for (const escalator of FRUSTRATION_ESCALATORS) {
    if (lowerText.includes(escalator)) {
      score += 8;
    }
  }

  const consecutiveQuestions = (transcript.match(/\?.*?\?.*?\?/g) || []).length;
  if (consecutiveQuestions > 0) {
    score += consecutiveQuestions * 5;
    markers.push(`${consecutiveQuestions}_consecutive_questions`);
  }

  const allCaps = (transcript.match(/[A-Z]{5,}/g) || []).length;
  if (allCaps > 0) {
    score += allCaps * 10;
    markers.push('all_caps_emphasis');
  }

  const shortResponses = lines.filter((l) => l.trim().length < 10 && l.includes('?')).length;
  if (shortResponses > 3) {
    score += shortResponses * 3;
    markers.push('short_frustrated_questions');
  }

  score = Math.min(100, score);

  return {
    callId: '',
    distressScore: score,
    isEscalationTriggered: score >= 50,
    markers,
    recommendation: score >= 75 ? 'escalate_now' : score >= 50 ? 'escalate_after_current_goal' : 'continue',
  };
}

export async function checkAndTriggerEscalation(
  prisma: PrismaClient,
  callAttemptId: string,
  transcript: string,
): Promise<SentimentSignal | null> {
  const sentiment = analyzeSentiment(transcript);

  if (!sentiment.isEscalationTriggered) {
    return null;
  }

  const attempt = await prisma.callAttempt.findUnique({
    where: { id: callAttemptId },
    select: { id: true, claimId: true, vapiCallId: true },
  });

  if (!attempt) return null;

  await prisma.escalation.create({
    data: {
      claimId: attempt.claimId,
      type: 'SENTIMENT_DISTRESS',
      severity: sentiment.distressScore >= 75 ? 'HIGH' : 'MEDIUM',
      reason: `Sentiment analysis detected ${sentiment.distressScore}% distress. Markers: ${sentiment.markers.join(', ')}`,
      metadata: {
        sentiment,
        callAttemptId,
      },
      status: 'OPEN',
    },
  });

  await prisma.callAttempt.update({
    where: { id: callAttemptId },
    data: {
      liveState:
        sentiment.recommendation === 'escalate_now' ? 'escalate_immediate' : 'escalate_after_goal',
    },
  });

  return {
    ...sentiment,
    callId: attempt.vapiCallId,
  };
}

export async function getEscalationRate(
  prisma: PrismaClient,
  practiceId: string,
  windowDays = 7,
): Promise<{
  totalCalls: number;
  sentimentEscalations: number;
  escalatonRate: number;
}> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const [totalAttempts, sentimentEscalations] = await Promise.all([
    prisma.callAttempt.count({
      where: {
        claim: { practiceId },
        completedAt: { gte: since },
      },
    }),
    prisma.escalation.count({
      where: {
        claim: { practiceId },
        type: 'SENTIMENT_DISTRESS',
        createdAt: { gte: since },
      },
    }),
  ]);

  return {
    totalCalls: totalAttempts,
    sentimentEscalations,
    escalatonRate:
      totalAttempts > 0 ? Math.round((sentimentEscalations / totalAttempts) * 1000) / 10 : 0,
  };
}
