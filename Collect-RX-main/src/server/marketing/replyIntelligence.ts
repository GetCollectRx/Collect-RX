import type { PrismaClient, Prospect } from '@prisma/client';
import { runGeminiJson } from './geminiClient.js';
import { sendHotLeadAlert } from './hotLeadAlerts.js';
import { logProspectActivity } from './prospectActivity.js';
import { sendProspectEmail } from './prospectEmail.js';
import { getReplyTemplate } from './replyTemplates.js';

import type { ReplyIntent } from './marketingTypes.js';

interface ReplyAnalysis {
  intent: ReplyIntent;
  summary: string;
  suggestedReply?: string;
}

export async function processInboundReply(
  prisma: PrismaClient,
  prospect: Prospect,
  replyText: string,
  fromEmail: string,
): Promise<void> {
  if (prospect.optOutAt) return;

  const analysis = await classifyReply(prospect, replyText, fromEmail);
  const template = getReplyTemplate(analysis.intent, prospect, replyText);
  const suggestedReply = template?.text ?? analysis.suggestedReply;

  const existingMeta =
    prospect.metadata && typeof prospect.metadata === 'object' && !Array.isArray(prospect.metadata)
      ? (prospect.metadata as Record<string, unknown>)
      : {};

  await prisma.prospect.update({
    where: { id: prospect.id },
    data: {
      replyIntent: analysis.intent,
      suggestedReply: suggestedReply ?? null,
      lastEngagedAt: new Date(),
      // Stops the follow-up scheduler: it only selects prospects with
      // emailRepliedAt still null.
      emailRepliedAt: new Date(),
      metadata: {
        ...existingMeta,
        lastInboundReply: replyText.slice(0, 4000),
        suggestedReplySubject: template?.subject ?? null,
      },
    },
  });

  await logProspectActivity(prisma, prospect.id, 'email_reply', analysis.summary, {
    intent: analysis.intent,
    suggestedReply,
    fromEmail,
    autoSend: template?.autoSend ?? false,
  });

  if (template?.autoSend && template.html) {
    await sendProspectEmail(
      prospect,
      {
        subject: template.subject,
        html: template.html,
        text: template.text,
        activityType: `reply_auto_${analysis.intent}`,
      },
      prisma,
    );
  }

  if (analysis.intent === 'unsubscribe') {
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: {
        optOutAt: new Date(),
        stage: 'opted_out',
        sequenceCompleted: true,
      },
    });
    return;
  }

  if (analysis.intent === 'auto_reply' || analysis.intent === 'wrong_number') {
    return;
  }

  if (analysis.intent === 'positive') {
    await advanceStage(prisma, prospect.id, 'engaged');
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { sequenceCompleted: true },
    });
    const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    await sendHotLeadAlert(updated, 'positive_reply', analysis.summary);
    return;
  }

  if (analysis.intent === 'objection') {
    const pauseUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { sequencePausedUntil: pauseUntil },
    });
  }
}

async function classifyReply(
  prospect: Prospect,
  replyText: string,
  fromEmail: string,
): Promise<ReplyAnalysis> {
  const prompt = `Classify this inbound email reply from a dental practice prospect.
Practice: ${prospect.practiceName}
From: ${fromEmail}
Reply:
"""
${replyText.slice(0, 4000)}
"""

Return JSON only:
{
  "intent": "positive" | "objection" | "unsubscribe" | "wrong_number" | "auto_reply" | "neutral",
  "summary": "one line summary"
}`;

  const parsed = await runGeminiJson<ReplyAnalysis>(prompt);
  if (parsed?.intent && parsed.summary) {
    return parsed;
  }

  return classifyReplyHeuristic(replyText);
}

function classifyReplyHeuristic(replyText: string): ReplyAnalysis {
  const lower = replyText.toLowerCase();
  if (/unsubscribe|remove me|stop emailing|opt.?out|do not contact/.test(lower)) {
    return { intent: 'unsubscribe', summary: 'Requested to stop emails' };
  }
  if (/out of office|auto.?reply|automatic reply/.test(lower)) {
    return { intent: 'auto_reply', summary: 'Auto-reply detected' };
  }
  if (/wrong (email|person|number)|not a dental|don't work here/.test(lower)) {
    return { intent: 'wrong_number', summary: 'Wrong recipient signal' };
  }
  if (/interested|sounds good|let's talk|book|demo|yes|call me/.test(lower)) {
    return { intent: 'positive', summary: 'Expressed interest' };
  }
  if (/too small|not ready|already have|no budget|busy|not a priority|maybe later/.test(lower)) {
    return { intent: 'objection', summary: 'Raised an objection or timing concern' };
  }
  return { intent: 'neutral', summary: 'Reply received, needs manual review' };
}

async function advanceStage(
  prisma: PrismaClient,
  prospectId: string,
  stage: Prospect['stage'],
): Promise<void> {
  await prisma.prospect.update({
    where: { id: prospectId },
    data: { stage, lastEngagedAt: new Date() },
  });
}

/** Send the suggested reply draft via SendGrid (one-click from admin UI). */
export async function sendSuggestedReply(
  prisma: PrismaClient,
  prospectId: string,
): Promise<{ sent: boolean }> {
  const prospect = await prisma.prospect.findUniqueOrThrow({ where: { id: prospectId } });
  if (!prospect.email || prospect.optOutAt) {
    throw new Error('Prospect has no email or has opted out');
  }
  if (!prospect.suggestedReply?.trim()) {
    throw new Error('No suggested reply on file');
  }

  const meta =
    prospect.metadata && typeof prospect.metadata === 'object' && !Array.isArray(prospect.metadata)
      ? (prospect.metadata as Record<string, unknown>)
      : {};
  const lastReply =
    typeof meta.lastInboundReply === 'string' ? meta.lastInboundReply : prospect.suggestedReply;
  const intent = (prospect.replyIntent || 'neutral') as ReplyIntent;
  const template = getReplyTemplate(intent, prospect, lastReply);

  if (!template) {
    throw new Error('Could not build reply template');
  }

  const subject =
    typeof meta.suggestedReplySubject === 'string' && meta.suggestedReplySubject.trim()
      ? meta.suggestedReplySubject.trim()
      : template.subject;

  const sent = await sendProspectEmail(
    prospect,
    {
      subject,
      html: template.html,
      text: template.text,
      activityType: 'reply_manual_send',
    },
    prisma,
  );

  if (!sent && process.env.SENDGRID_API_KEY) {
    throw new Error('SendGrid send failed');
  }

  await logProspectActivity(prisma, prospectId, 'reply_sent', subject, { manual: true });

  if (intent === 'positive') {
    await advanceStage(prisma, prospectId, 'engaged');
    await prisma.prospect.update({
      where: { id: prospectId },
      data: { sequenceCompleted: true, suggestedReply: null },
    });
  } else {
    await prisma.prospect.update({
      where: { id: prospectId },
      data: { suggestedReply: null },
    });
  }

  return { sent: sent || !process.env.SENDGRID_API_KEY };
}
