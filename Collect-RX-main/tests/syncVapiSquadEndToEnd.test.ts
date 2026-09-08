/**
 * End-to-end coverage for sync-vapi-squad.ts's main() flow, with Vapi's API
 * mocked out entirely — this sandbox cannot reach api.vapi.ai (network
 * egress policy), so this is the only way to verify the full script here
 * rather than only its two smallest helper functions in isolation.
 *
 * Vapi's exact GET /assistant response shape is unverified against their
 * live docs (also unreachable from here) — these mocks assert the shape
 * this script currently assumes (a bare JSON array), matching what
 * assertAssistantArray() in the script itself now guards at runtime. If
 * that assumption is ever wrong, assertAssistantArray throws a clear error
 * instead of a cryptic one — see syncVapiSquad.test.ts for coverage of that
 * function directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, main } from '../scripts/sync-vapi-squad';

const config = loadConfig();
const memberNames = config.squad.members.map((m) => m.assistant.name);

/** Build a "live" assistant that exactly mirrors a repo member, plus server-managed fields. */
function liveEchoOf(name: string, overrides: Record<string, unknown> = {}) {
  const member = config.squad.members.find((m) => m.assistant.name === name);
  if (!member) throw new Error(`fixture setup: no repo member named ${name}`);
  return {
    ...member.assistant,
    id: `live-${name}`,
    orgId: 'org-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('sync-vapi-squad main() end-to-end (mocked Vapi API)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    process.env.VAPI_API_KEY = 'test-key';
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    vi.unstubAllGlobals();
    delete process.env.VAPI_API_KEY;
  });

  function mockListResponse(assistants: unknown[]) {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/assistant?') && !String(url).includes('createdAtLt')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(assistants),
        });
      }
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
  }

  it('reports [OK] for every member when live exactly matches repo — exit code stays clean', async () => {
    const live = memberNames.map((n) => liveEchoOf(n));
    mockListResponse(live);

    await main([]);

    expect(process.exitCode).toBeUndefined();
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    for (const name of memberNames) {
      expect(output).toContain(`[OK] ${name}`);
    }
    expect(output).not.toContain('[DRIFT]');
    expect(output).not.toContain('[MISSING]');
  });

  it('reports [DRIFT] and sets exit code 1 when a live assistant differs from repo, without pushing (check mode)', async () => {
    const live = memberNames.map((n) =>
      n === 'Claims_Agent' ? liveEchoOf(n, { firstMessage: 'An old, un-pushed first message' }) : liveEchoOf(n),
    );
    mockListResponse(live);

    await main([]);

    expect(process.exitCode).toBe(1);
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('[DRIFT] Claims_Agent');
    expect(output).toContain('An old, un-pushed first message');
    // check mode must never PATCH
    expect(fetchMock.mock.calls.every(([, opts]: [string, RequestInit?]) => opts?.method !== 'PATCH')).toBe(true);
  });

  it('pushes the repo config to the live assistant in --push mode when drifted', async () => {
    const live = memberNames.map((n) =>
      n === 'Claims_Agent' ? liveEchoOf(n, { firstMessage: 'An old, un-pushed first message' }) : liveEchoOf(n),
    );
    mockListResponse(live);
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes('/assistant?')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(live) });
      }
      if (String(url).includes('/assistant/live-Claims_Agent') && opts?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      throw new Error(`Unexpected fetch call in test: ${url} ${opts?.method}`);
    });

    await main(['--push']);

    const patchCall = fetchMock.mock.calls.find(([, opts]: [string, RequestInit?]) => opts?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    const [patchUrl, patchOpts] = patchCall as [string, RequestInit];
    expect(patchUrl).toContain('/assistant/live-Claims_Agent');
    const body = JSON.parse(String(patchOpts.body));
    expect(body.firstMessage).not.toBe('An old, un-pushed first message');
    expect(body.name).toBe('Claims_Agent');
    // server-managed fields must never be pushed back
    expect(body.id).toBeUndefined();
    expect(body.createdAt).toBeUndefined();

    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Pushed 1 update(s).');
  });

  it('reports [MISSING] and exit code 1 when a repo member has no live assistant', async () => {
    const live = memberNames.filter((n) => n !== 'Escalation_Closer').map((n) => liveEchoOf(n));
    mockListResponse(live);

    await main([]);

    expect(process.exitCode).toBe(1);
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('[MISSING] Escalation_Closer');
  });

  it('reports [AMBIGUOUS] and exit code 1 when two live assistants share a name', async () => {
    const live = [
      ...memberNames.map((n) => liveEchoOf(n)),
      liveEchoOf('Claims_Agent', { id: 'live-Claims_Agent-duplicate' }),
    ];
    mockListResponse(live);

    await main([]);

    expect(process.exitCode).toBe(1);
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('[AMBIGUOUS] Claims_Agent');
    expect(output).toContain('live-Claims_Agent');
    expect(output).toContain('live-Claims_Agent-duplicate');
  });

  it('--only restricts the check to a single named member', async () => {
    const live = memberNames.map((n) =>
      n === 'Resolution_Closer' ? liveEchoOf(n, { firstMessage: 'drifted' }) : liveEchoOf(n),
    );
    mockListResponse(live);

    await main(['--only', 'Claims_Agent']);

    expect(process.exitCode).toBeUndefined();
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('[OK] Claims_Agent');
    expect(output).not.toContain('Resolution_Closer');
    expect(output).toContain('Checked 1 squad member(s)');
  });

  it('throws a clear error, not a crash, when Vapi returns a non-array shape', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }),
    );

    await expect(main([])).rejects.toThrow(/Expected GET .* to return a JSON array/);
  });

  it('paginates when a page comes back full (100 items)', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `live-page1-${i}`,
      name: `Unrelated_${i}`,
      createdAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    const page2 = memberNames.map((n) => liveEchoOf(n));

    let call = 0;
    fetchMock.mockImplementation((url: string) => {
      call += 1;
      if (call === 1) {
        expect(String(url)).not.toContain('createdAtLt');
        return Promise.resolve({ ok: true, json: () => Promise.resolve(page1) });
      }
      expect(String(url)).toContain('createdAtLt');
      return Promise.resolve({ ok: true, json: () => Promise.resolve(page2) });
    });

    await main([]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    for (const name of memberNames) {
      expect(output).toContain(`[OK] ${name}`);
    }
  });
});
