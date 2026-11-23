import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import express from 'express';
import { createServer } from 'http';
import { validTwilioSignature } from '../src/server/conference/twilioSignature';
import { createConferenceRouter } from '../src/server/conference/conferenceRoutes';

const sign = (token: string, url: string, p: Record<string, string>) =>
  createHmac('sha1', token).update(url + Object.keys(p).sort().map((k) => k + p[k]).join('')).digest('base64');

describe('twilio signature', () => {
  it('accepts a correct signature and rejects wrong or missing', () => {
    const p = { CallStatus: 'busy', To: '+1' };
    const s = sign('tok', 'https://x.test/a', p);
    expect(validTwilioSignature('tok', s, 'https://x.test/a', p)).toBe(true);
    expect(validTwilioSignature('tok', s, 'https://x.test/b', p)).toBe(false);
    expect(validTwilioSignature('tok', undefined, 'https://x.test/a', p)).toBe(false);
    expect(validTwilioSignature('', s, 'https://x.test/a', p)).toBe(false);
  });
});

describe('conference routes', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  async function post(path: string, body: Record<string, string>, headers: Record<string, string> = {}, consent: (id: string) => Promise<boolean> = async () => true) {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use('/c', createConferenceRouter(consent));
    const srv = createServer(app);
    await new Promise<void>((r) => srv.listen(0, r));
    const port = (srv.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/c${path}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(body).toString(),
    });
    const text = await res.text();
    srv.close();
    return { status: res.status, text };
  }
  it('is closed (404) unless enabled', async () => {
    expect((await post('/staff-twiml?room=room-abcdef12', {})).status).toBe(404);
  });
  it('rejects unsigned requests when enabled', async () => {
    process.env.CONFERENCE_HANDOFF_ENABLED = 'true'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.PUBLIC_API_BASE_URL = 'https://x.test';
    expect((await post('/staff-twiml?room=room-abcdef12', {})).status).toBe(403);
  });
  it('serves muted listener TwiML for a signed request', async () => {
    process.env.CONFERENCE_HANDOFF_ENABLED = 'true'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.PUBLIC_API_BASE_URL = 'https://x.test';
    const url = 'https://x.test/c/listener-twiml?room=room-abcdef12&practiceId=p1';
    const r = await post('/listener-twiml?room=room-abcdef12&practiceId=p1', {}, { 'x-twilio-signature': sign('tok', url, {}) });
    expect(r.status).toBe(200);
    expect(r.text).toContain('muted="true"');
  });
  it('refuses the listener when the practice has not acknowledged it or the lookup fails', async () => {
    process.env.CONFERENCE_HANDOFF_ENABLED = 'true'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.PUBLIC_API_BASE_URL = 'https://x.test';
    const url = 'https://x.test/c/listener-twiml?room=room-abcdef12&practiceId=p1';
    const h = { 'x-twilio-signature': sign('tok', url, {}) };
    expect((await post('/listener-twiml?room=room-abcdef12&practiceId=p1', {}, h, async () => false)).status).toBe(403);
    expect((await post('/listener-twiml?room=room-abcdef12&practiceId=p1', {}, h, async () => { throw new Error('db'); })).status).toBe(403);
  });
});
