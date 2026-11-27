/**
 * The server sends script-src-attr 'none' (helmet's default), so an inline event-handler attribute in the
 * HTML shell never runs. The fonts once stayed on media="print" because of one. Keep handlers out of it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('index.html under the app CSP', () => {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

  it('has no inline event-handler attributes', () => {
    const handlers = [...html.matchAll(/<[a-z][^>]*\s(on[a-z]+)\s*=/giu)].map((m) => m[1]);
    expect(handlers).toEqual([]);
  });

  it('loads the font stylesheet for every media type', () => {
    const fontLinks = [...html.matchAll(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/giu)].map((m) => m[0]);
    expect(fontLinks.length).toBeGreaterThan(0);
    for (const tag of fontLinks) expect(tag).not.toMatch(/media\s*=\s*"print"/iu);
  });
});
