// ─────────────────────────────────────────────────────────────────────────────
// CollectRx: Hold-Park Billing Test Endpoint (temporary, engineering test only)
//
// Purpose: gives Twilio somewhere real to land a transferred call so the
// hold-park billing question can actually be tested. Does Vapi's per-minute
// orchestration rate stop once a call is forwarded out via transferCall
// (endedReason: assistant-forwarded-call), leaving only Twilio's PSTN rate?
//
// The prior attempt at this test died in under a second because the test
// number's voice webhook pointed at a decommissioned Railway deployment
// (collect-rx-production.up.railway.app, confirmed dead, see
// tasks/lessons.md for the Railway to Fly.io history that explains why that
// stale reference existed). This route gives a live landing point instead.
//
// NOT part of the production call-handling path, no claim, practice, or PHI
// data touches this route. Safe to remove once the hold-park test is done.
//
// TEST PROTOCOL: after placing one real call, transferring it here, and
// leaving it parked 3-5 minutes before hanging up, pull three timelines and
// line them up against each other:
//   1. Vapi dashboard (or GET /call/{id}): billed cost, duration, and the
//      exact timestamp `endedReason: assistant-forwarded-call` fired.
//   2. Twilio call logs: the conference leg's own duration and price,
//      separate from Vapi's call record.
//   3. `fly logs -a collect-rx | grep HOLD_PARK`: this route's own
//      HOLD_PARK_WEBHOOK_HIT and HOLD_PARK_CONFERENCE_STATUS timestamps, a
//      cross-check independent of what either vendor's dashboard reports.
// The open question this settles: does Vapi's billed cost stop accruing at
// the handoff moment, or does it keep climbing through the parked minutes?
// Nothing here proves that in advance, it's only decidable from the real
// call's numbers once all three timelines are compared.
// ─────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';
import logger from '../logger.cjs';
import { isResumeLegExpected } from './holdParkAudioStream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const CONFERENCE_NAME = 'collectrx-holdpark-test';
const STATUS_CALLBACK_URL = 'https://collect-rx.fly.dev/api/webhooks/hold-park/conference-status';
const WAIT_URL = 'https://collect-rx.fly.dev/api/webhooks/hold-park/wait';
const MUSIC_URL = 'https://collect-rx.fly.dev/api/webhooks/hold-park/holdmusic.mp3';
const AUDIO_STREAM_URL = 'wss://collect-rx.fly.dev/ws/hold-park-audio';

// This URL is this Vapi phone number's configured server.url, which means it
// gets two unrelated kinds of traffic: Twilio's own voice webhook fetch
// (application/x-www-form-urlencoded, CallSid/From/To) when a call actually
// lands on the number, AND Vapi's own server-event stream (application/json,
// {message:{type,...}}) for every call that merely uses this number as caller
// ID - status updates, transcripts, tool-call notices, none of which want or
// expect a TwiML response. Mixing them up is what produced the garbled first
// live test. Distinguish by content-type before doing anything else.
router.post('/', (req: Request, res: Response) => {
  const contentType = req.headers['content-type'] ?? '';

  if (contentType.includes('application/json')) {
    logger.info('[holdParkTest] vapi server-event received (not a Twilio call landing here)', {
      event: 'HOLD_PARK_VAPI_EVENT',
      messageType: (req.body as { message?: { type?: string } } | undefined)?.message?.type ?? 'unknown',
      timestamp: new Date().toISOString(),
    });
    res.sendStatus(200);
    return;
  }

  const callSid = typeof req.body?.CallSid === 'string' ? req.body.CallSid : 'unknown';
  const from = typeof req.body?.From === 'string' ? req.body.From : '';
  const to = typeof req.body?.To === 'string' ? req.body.To : '';
  const direction = typeof req.body?.Direction === 'string' ? req.body.Direction : '';
  // The resume call now dials in using the same number as its own caller ID
  // (see holdParkAudioStream.ts), so From/To are identical on both the
  // original transferred leg and the resume leg - can't tell them apart by
  // phone number anymore. isResumeLegExpected() is a short-lived flag set
  // right before the resume call fires, consumed here on the next hit.
  const isResumeLeg = isResumeLegExpected();

  logger.info('[holdParkTest] twilio voice webhook hit, parking call in conference', {
    event: 'HOLD_PARK_WEBHOOK_HIT',
    callSid,
    from,
    to,
    direction,
    conferenceName: CONFERENCE_NAME,
    isResumeLeg,
    timestamp: new Date().toISOString(),
  });

  const streamBlock = isResumeLeg
    ? ''
    : `<Start>
    <Stream url="${AUDIO_STREAM_URL}" track="inbound_track" />
  </Start>
  `;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${streamBlock}<Dial>
    <Conference
      startConferenceOnEnter="true"
      endConferenceOnExit="true"
      waitUrl="${WAIT_URL}"
      beep="false"
      statusCallback="${STATUS_CALLBACK_URL}"
      statusCallbackEvent="start end"
      statusCallbackMethod="POST"
    >${CONFERENCE_NAME}</Conference>
  </Dial>
</Response>`;

  res.set('Content-Type', 'text/xml');
  res.send(twiml);
});

// Twilio's own default hold-music file (com.twilio.music.hold) returned a 502
// mid-test (Twilio notification error 11200), which is what actually produced
// the "application error, goodbye" message, not our TwiML or webhook. Serving
// our own file below removes that external dependency entirely. loop="0" asks
// Twilio to loop the track indefinitely within one fetch, so it doesn't need
// to keep re-requesting this route while the call sits parked.
router.post('/wait', (_req: Request, res: Response) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play loop="0">${MUSIC_URL}</Play>
</Response>`;
  res.set('Content-Type', 'text/xml');
  res.send(twiml);
});

// "Local Forecast - Elevator" by Kevin MacLeod (incompetech.com), Creative
// Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/).
// <Play> fetches via GET by default, unlike Twilio's other TwiML callbacks.
router.get('/holdmusic.mp3', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'assets', 'holdmusic.mp3'));
});

// Twilio calls this separately when the conference starts/ends, gives a
// clean start/end timestamp pair independent of what Vapi or Twilio's own
// call logs report, as a third cross-check data point.
router.post('/conference-status', (req: Request, res: Response) => {
  logger.info('[holdParkTest] conference status callback', {
    event: 'HOLD_PARK_CONFERENCE_STATUS',
    conferenceSid: req.body?.ConferenceSid,
    statusCallbackEvent: req.body?.StatusCallbackEvent,
    friendlyName: req.body?.FriendlyName,
    timestamp: new Date().toISOString(),
  });
  res.sendStatus(200);
});

export default router;
