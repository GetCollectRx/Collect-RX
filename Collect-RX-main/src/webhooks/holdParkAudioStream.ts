// ─────────────────────────────────────────────────────────────────────────────
// CollectRx: Hold-Park Auto-Resume Listener (temporary, engineering test only)
//
// Purpose: while a call sits parked in the hold-park Twilio conference
// (src/webhooks/holdParkTest.ts), Vapi is off the line entirely. That is
// the whole point, it is what keeps the parked minutes cheap. But nothing
// is listening for when a live carrier rep actually picks up, so nothing
// currently brings Vapi back to resume the conversation automatically.
//
// This attaches to the parked leg's own Twilio Media Stream (a Call
// subresource, works via <Start><Stream> in TwiML, confirmed against
// Twilio's docs, no Conference-level streaming resource needed) and runs a
// cheap, local energy heuristic against the raw audio, no per-minute STT
// cost. Currently pure activity detection over a rolling ~1s window (60% of
// frames above an energy floor), deliberately not yet trying to tell hold
// music from speech via variance, since the first live attempt showed the
// trigger logic itself (100% of frames required, consecutively, no gaps)
// never fired even during continuous talking. Isolating "does energy
// detection work at all" from "does it discriminate music" until there is
// real calibration data from HOLD_PARK_AUDIO_DIAGNOSTIC log lines. If hold
// music alone turns out to cross the energy floor, add a variance gate back
// using real numbers instead of guessing at a threshold again.
// It is a heuristic, not a transcript: no audio is stored or transcribed,
// only rolling energy numbers computed in memory and discarded per frame.
//
// On a confident detection, it fires a second Vapi call that dials the
// hold-park number itself, which lands back on the same conference by name
// via src/webhooks/holdParkTest.ts's existing TwiML, bringing a live Vapi
// assistant back into the call. No new Twilio number or REST credentials
// needed for that; it reuses the same TwiML the original transfer used.
//
// Safe to remove once the hold-park test is done, not part of the
// production call-handling path.
// ─────────────────────────────────────────────────────────────────────────────

import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import axios from 'axios';
import logger from '../logger.cjs';

const WS_PATH = '/ws/hold-park-audio';

const HOLD_PARK_NUMBER = '+16139098770';
// Originally used the "TEST IVR sim line" (a free Vapi-provided number) as a
// distinct caller ID so this call wouldn't dial itself as its own
// destination. That failed live with "Free Vapi numbers do not support
// international calls" (+1 US vs +1 Canada counts as international to Vapi's
// free-number restriction, even both being NANP). Confirmed via a direct API
// call that the production number dialing itself is accepted with no error,
// since it's a real Twilio number and not subject to that restriction.
const RESUME_CALLER_PHONE_NUMBER_ID = 'a4003bab-7509-44bd-9af4-7c9e1e7e6e73';

const FRAME_SAMPLES = 160; // 20ms @ 8kHz mu-law, per Twilio's Media Streams format
const WINDOW_FRAMES = 15; // ~300ms, shortened from 50 (~1s) after real audio data showed a
// single short utterance like "hello" only holds active energy for roughly half a second with
// gaps between words, never filling a full 1s window at the fraction needed below.
const ACTIVE_FRACTION_NEEDED = 0.5; // 50% of the window active, not 100% consecutive
const MIN_ACTIVE_RMS = 400; // confirmed against real audio: speech peaks hit 1420-3232, silence/
// hold-music-only stretches sat at 0, so this floor cleanly separates the two in practice.
const DIAGNOSTIC_LOG_EVERY_N_FRAMES = 25; // ~500ms, real numbers to calibrate against, not guesses

function muLawByteToPcm16(muLawByte: number): number {
  const MULAW_BIAS = 0x84;
  const inverted = ~muLawByte & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign ? -sample : sample;
}

function frameRms(muLawFrame: Buffer): number {
  let sumSquares = 0;
  for (let i = 0; i < muLawFrame.length; i++) {
    const sample = muLawByteToPcm16(muLawFrame[i]);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / muLawFrame.length);
}

function stdev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

type StreamState = {
  callSid: string;
  energyHistory: number[];
  activeHistory: boolean[];
  triggered: boolean;
  startedAt: number;
  frameCount: number;
};

// The resume call now uses HOLD_PARK_NUMBER as its own caller ID (see
// RESUME_CALLER_PHONE_NUMBER_ID comment above), which means Twilio's webhook
// body shows the identical From/To on both the original transferred leg and
// the resume leg landing on this same number - From/To can no longer tell
// them apart. This is the replacement: a short-lived flag set right before
// firing the resume call, consumed by holdParkTest.ts on the next hit.
let resumeLegExpectedUntil = 0;

export function isResumeLegExpected(): boolean {
  if (Date.now() >= resumeLegExpectedUntil) return false;
  resumeLegExpectedUntil = 0; // consume it, one shot
  return true;
}

async function triggerHoldParkResume(callSid: string): Promise<void> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    logger.error('[holdParkAudioStream] VAPI_API_KEY not set, cannot fire resume call', {
      event: 'HOLD_PARK_RESUME_SKIPPED_NO_KEY',
      callSid,
    });
    return;
  }

  resumeLegExpectedUntil = Date.now() + 15000; // 15s to actually land on the webhook

  await axios.post(
    'https://api.vapi.ai/call/phone',
    {
      assistant: {
        name: 'HoldParkAutoResume',
        firstMessage: "Thanks for holding, I'm back. Go ahead.",
        firstMessageMode: 'assistant-speaks-first',
        model: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          temperature: 0.4,
          messages: [
            {
              role: 'system',
              content:
                'This is an internal engineering test call, no real patient or insurance data is involved. Have a brief natural conversation confirming the call resumed correctly, then end politely.',
            },
          ],
        },
        voice: { provider: 'vapi', voiceId: 'Elliot' },
        maxDurationSeconds: 300,
      },
      phoneNumberId: RESUME_CALLER_PHONE_NUMBER_ID,
      customer: { number: HOLD_PARK_NUMBER, name: 'Hold-park auto-resume' },
      metadata: { test: true, purpose: 'hold_park_auto_resume', triggeredByCallSid: callSid },
    },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
  );
}

export function attachHoldParkAudioStream(server: Server): WebSocketServer {
  // noServer + a manually-scoped 'upgrade' listener, not the {server, path}
  // shortcut, ws's own maintainers document that option as unreliable once
  // more than one WebSocketServer shares an http.Server (attachDeskWebSocket
  // already attaches one for /ws/desk), so each instance needs to claim only
  // its own path and leave every other upgrade request alone.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (req.url !== WS_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    let state: StreamState | null = null;

    ws.on('message', (raw: Buffer) => {
      let msg: { event?: string; start?: { callSid?: string }; media?: { payload?: string } };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.event === 'start') {
        const callSid = msg.start?.callSid ?? 'unknown';
        state = { callSid, energyHistory: [], activeHistory: [], triggered: false, startedAt: Date.now(), frameCount: 0 };
        logger.info('[holdParkAudioStream] stream started', {
          event: 'HOLD_PARK_STREAM_STARTED',
          callSid,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (msg.event === 'media' && state && !state.triggered && msg.media?.payload) {
        const muLawFrame = Buffer.from(msg.media.payload, 'base64');
        if (muLawFrame.length < FRAME_SAMPLES) return;

        state.frameCount++;
        const rms = frameRms(muLawFrame);
        state.energyHistory.push(rms);
        if (state.energyHistory.length > WINDOW_FRAMES) state.energyHistory.shift();

        const isActive = rms > MIN_ACTIVE_RMS;
        state.activeHistory.push(isActive);
        if (state.activeHistory.length > WINDOW_FRAMES) state.activeHistory.shift();

        const variance = stdev(state.energyHistory);
        const activeFraction = state.activeHistory.filter(Boolean).length / state.activeHistory.length;
        const windowFull = state.activeHistory.length >= WINDOW_FRAMES;

        if (state.frameCount % DIAGNOSTIC_LOG_EVERY_N_FRAMES === 0) {
          logger.info('[holdParkAudioStream] audio diagnostic sample', {
            event: 'HOLD_PARK_AUDIO_DIAGNOSTIC',
            callSid: state.callSid,
            rms: Math.round(rms),
            variance: Math.round(variance),
            activeFraction: Math.round(activeFraction * 100) / 100,
            timestamp: new Date().toISOString(),
          });
        }

        if (windowFull && activeFraction >= ACTIVE_FRACTION_NEEDED) {
          state.triggered = true;
          const detectedAfterMs = Date.now() - state.startedAt;
          logger.info('[holdParkAudioStream] live speech detected, firing resume call', {
            event: 'HOLD_PARK_AUTO_RESUME_TRIGGERED',
            callSid: state.callSid,
            detectedAfterMs,
            rms: Math.round(rms),
            variance: Math.round(variance),
            activeFraction: Math.round(activeFraction * 100) / 100,
            timestamp: new Date().toISOString(),
          });
          triggerHoldParkResume(state.callSid).catch((err) => {
            const axiosErr = err as { message: string; response?: { data?: unknown } };
            logger.error('[holdParkAudioStream] resume call failed to fire', {
              event: 'HOLD_PARK_AUTO_RESUME_FAILED',
              callSid: state?.callSid,
              error: axiosErr.message,
              responseBody: axiosErr.response?.data,
            });
          });
        }
        return;
      }

      if (msg.event === 'stop' && state) {
        logger.info('[holdParkAudioStream] stream stopped', {
          event: 'HOLD_PARK_STREAM_STOPPED',
          callSid: state.callSid,
          triggered: state.triggered,
          timestamp: new Date().toISOString(),
        });
      }
    });
  });

  return wss;
}
