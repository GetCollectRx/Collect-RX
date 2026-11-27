import { Router, type Request, type Response } from 'express';
import { classifyStaffLeg, isSafeRoomName, participantTwiml, scriptedRepTwiml, shouldFallBackToReferenceScript } from './conferenceLogic.js';
import { validTwilioSignature } from './twilioSignature.js';
import { emitHandoffEvent } from '../frontDesk/handoffEvents.js';
import { listenerAllowed } from '../frontDesk/listenerConsent.js';

/** Looks up whether a practice acknowledged the silent listener. Injected so tests need no database. */
export type ConsentLookup = (practiceId: string) => Promise<boolean>;

export const defaultConsentLookup: ConsentLookup = async (practiceId) => {
  const { prisma } = await import('../../lib/prisma.js');
  const { getPracticeSettings } = await import('../services/practiceSettingsService.js');
  return listenerAllowed(await getPracticeSettings(prisma, practiceId));
};

/**
 * Conference webhooks for the staff handoff (Phase 1 spike). Not mounted
 * anywhere yet. When mounted it is closed unless CONFERENCE_HANDOFF_ENABLED is
 * "true", every request must carry a valid Twilio signature, and room names
 * must be opaque ids. No audio is recorded and nothing but ids is logged.
 */
export function conferenceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONFERENCE_HANDOFF_ENABLED === 'true';
}

function guard(req: Request, res: Response): Record<string, string> | null {
  if (!conferenceEnabled()) { res.status(404).end(); return null; }
  const params = (req.body ?? {}) as Record<string, string>;
  const base = (process.env.PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
  const ok = validTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN ?? '',
    req.header('x-twilio-signature'),
    `${base}${req.originalUrl}`,
    params,
  );
  if (!ok) { res.status(403).end(); return null; }
  return params;
}

export function createConferenceRouter(consent: ConsentLookup = defaultConsentLookup): Router {
  const r = Router();

  // Spike only: scripted carrier rep for one-phone testing. Off unless SPIKE_SCRIPTED_REP=true.
  r.post('/scripted-rep-twiml', (req, res) => {
    if (process.env.SPIKE_SCRIPTED_REP !== 'true') return res.status(404).end();
    if (!guard(req, res)) return;
    const room = String(req.query.room ?? '');
    if (!isSafeRoomName(room)) return res.status(400).end();
    res.type('text/xml').send(scriptedRepTwiml(room));
  });

  // Staff leg answers here and joins the room unmuted.
  r.post('/staff-twiml', (req, res) => {
    if (!guard(req, res)) return;
    const room = String(req.query.room ?? '');
    if (!isSafeRoomName(room)) return res.status(400).end();
    res.type('text/xml').send(participantTwiml(room, { muted: false }));
  });

  // Listener leg joins muted. It is never given a way to speak.
  r.post('/listener-twiml', async (req, res) => {
    if (!guard(req, res)) return;
    const room = String(req.query.room ?? '');
    if (!isSafeRoomName(room)) return res.status(400).end();
    // B-05: no listener without the practice's acknowledgment. Fail closed.
    const practiceId = String(req.query.practiceId ?? '');
    let allowed = false;
    try { allowed = practiceId !== '' && (await consent(practiceId)); } catch { allowed = false; }
    if (!allowed) return res.status(403).end();
    res.type('text/xml').send(participantTwiml(room, { muted: true }));
  });

  // Staff leg status: decide whether the rep needs the fallback script.
  r.post('/staff-status', (req, res) => {
    const p = guard(req, res);
    if (!p) return;
    const outcome = classifyStaffLeg({
      callStatus: p.CallStatus ?? '',
      answeredBy: p.AnsweredBy,
      durationSeconds: p.CallDuration ? Number(p.CallDuration) : undefined,
    });
    emitHandoffEvent(shouldFallBackToReferenceScript(outcome) ? 'handoff_no_log' : 'handoff_log_received', {
      vapiCallId: typeof req.query.callId === 'string' ? req.query.callId : undefined,
    });
    res.status(204).end();
  });
  return r;
}
