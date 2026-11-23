/** Minimal TwiML builders. Pure functions; XML-escapes every dynamic value. */

export function xmlEscape(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

export interface GatherOptions {
  action: string;
  input: 'dtmf' | 'speech' | 'dtmf speech';
  timeoutSeconds: number;
  numDigits?: number;
  finishOnKey?: string;
  hints?: string[];
  prompt: string;
}

export function say(text: string): string {
  return `<Say language="en-CA">${xmlEscape(text)}</Say>`;
}

export function gather(opts: GatherOptions): string {
  const attrs = [
    `input="${opts.input}"`,
    `action="${xmlEscape(opts.action)}"`,
    'method="POST"',
    `timeout="${opts.timeoutSeconds}"`,
    opts.numDigits !== undefined ? `numDigits="${opts.numDigits}"` : '',
    opts.finishOnKey !== undefined ? `finishOnKey="${xmlEscape(opts.finishOnKey)}"` : '',
    opts.hints && opts.hints.length > 0 ? `hints="${xmlEscape(opts.hints.join(','))}"` : '',
  ].filter((a) => a !== '');
  return `<Gather ${attrs.join(' ')}>${say(opts.prompt)}</Gather>`;
}

/** Hold music. A public Twilio sample track; only the TwiML string is inspected offline. */
export const HOLD_MUSIC_URL = 'https://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3';

export function play(url: string, loop = 1): string {
  return `<Play loop="${loop}">${xmlEscape(url)}</Play>`;
}

export function pause(seconds: number): string {
  return `<Pause length="${Math.max(1, Math.round(seconds))}"/>`;
}

export function redirect(url: string): string {
  return `<Redirect method="POST">${xmlEscape(url)}</Redirect>`;
}

export function hangup(): string {
  return '<Hangup/>';
}

export function response(...parts: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join('')}</Response>`;
}
