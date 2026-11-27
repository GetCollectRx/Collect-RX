/**
 * Carrier Twin server entry for Fly. Fails closed: it will not start without a
 * control token, and it requires Twilio signatures unless TWIN_ALLOW_UNSIGNED=1
 * (local smoke tests only).
 */
import { readFileSync } from 'node:fs';
import { createCarrierTwin } from '../carrierTwin.js';
import type { Scenario } from '../scenarios.js';

const control = process.env.TWIN_CONTROL_TOKEN ?? '';
const twilioAuth = process.env.TWILIO_AUTH_TOKEN ?? '';
const baseUrl = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/u, '');
const unsigned = process.env.TWIN_ALLOW_UNSIGNED === '1';
const port = Number(process.env.PORT ?? 8080);
const holdCap = Number(process.env.TWIN_HOLD_SECONDS ?? 0);

if (control.length < 24) {
  console.error('TWIN_CONTROL_TOKEN must be set to at least 24 characters');
  process.exit(1);
}
if (!unsigned && (twilioAuth === '' || baseUrl === '')) {
  console.error('TWILIO_AUTH_TOKEN and PUBLIC_BASE_URL are required so Twilio signatures can be checked');
  process.exit(1);
}

const all = JSON.parse(readFileSync(process.env.SCENARIOS_FILE ?? './scenarios.json', 'utf8')) as Scenario[];

/** Shortens holds so a test call costs minutes, not a quarter hour. Behaviour, not content, is what is under test. */
const scenarios = all.map((sc): Scenario => {
  if (!Number.isFinite(holdCap) || holdCap <= 0) return sc;
  const drop = sc.hold.dropAtSeconds === null ? null : Math.min(sc.hold.dropAtSeconds, Math.max(30, Math.floor(holdCap * 0.6)));
  const every = sc.hold.announcementEverySeconds === null ? null : Math.min(sc.hold.announcementEverySeconds, 20);
  return { ...sc, hold: { ...sc.hold, seconds: Math.min(sc.hold.seconds, holdCap), dropAtSeconds: drop, announcementEverySeconds: every } };
});

const twin = createCarrierTwin({
  scenarios,
  controlToken: control,
  twilioAuthToken: unsigned ? undefined : twilioAuth,
  publicBaseUrl: unsigned ? undefined : baseUrl,
  timeScale: 1,
  sinkSecret: process.env.TWIN_SINK_SECRET || undefined,
});

twin.app.get('/healthz', (_req, res) => {
  res.json({ ok: true, scenarios: scenarios.length, armed: twin.armed() });
});

twin.app.listen(port, '0.0.0.0', () => {
  console.warn(`carrier twin listening on ${port} with ${scenarios.length} scenarios; hold cap ${holdCap > 0 ? `${holdCap}s` : 'none'}; signatures ${unsigned ? 'OFF (smoke test)' : 'required'}`);
});
