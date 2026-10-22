// Step 1 (AC8, T8): no module places a carrier call except through the shared
// dispatch path. A new caller of the Vapi dial client must be added to the
// allowlist on purpose, in review, not by accident.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', 'src');

/** Files that may dial a carrier through the Vapi client, and why. */
const ALLOWED_CARRIER_DIAL_CALLERS: Record<string, string> = {
  'server/frontDesk/queueEngine.ts': 'scheduled dispatch',
  'routes/insurance.ts': 'manual Call now route, through the shared decision and builder',
  'server/preVisit/preVisitDispatch.ts': 'pre-visit eligibility calls: a separate product path with its own squad',
  'vapi/client.ts': 'the client itself',
};

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('carrier dial callers', () => {
  it('only the allowlisted modules call initiateCall or initiatePreVisitCall', () => {
    const offenders = walk(SRC)
      .map((file) => ({ file: relative(SRC, file).replace(/\\/g, '/'), text: readFileSync(file, 'utf8') }))
      .filter(({ text }) => /\b(initiateCall|initiatePreVisitCall)\s*\(/.test(withoutComments(text)))
      .map(({ file }) => file)
      .filter((file) => !(file in ALLOWED_CARRIER_DIAL_CALLERS));
    expect(offenders).toEqual([]);
  });

  it('both dispatching paths go through the shared builder and recorder', () => {
    for (const file of ['server/frontDesk/queueEngine.ts', 'routes/insurance.ts']) {
      const text = readFileSync(join(SRC, file), 'utf8');
      expect(text, file).toContain('buildVapiCallParams');
      expect(text, file).toContain('recordDispatchedCallAttempt');
      expect(text, file).toMatch(/validateDispatch\(/);
      expect(text, file).toMatch(/payerType:/);
    }
  });
});
