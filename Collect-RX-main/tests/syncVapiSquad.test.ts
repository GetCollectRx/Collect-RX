/**
 * Regression coverage for scripts/sync-vapi-squad.ts's pure diff logic.
 *
 * Found live, twice in one night, on a real machine with a real key:
 * 1. import.meta.dirname crashing on Node < 20.11 before any request ran.
 * 2. diffValues/truncate crashing on any field present on only one side of
 *    the diff (repo vs. live) — the exact normal case for a squad that has
 *    never been pushed with new fields yet, i.e. the case this script's
 *    whole reason for existing is supposed to handle. Neither was caught by
 *    typecheck or lint since both are runtime-shape issues, not type errors.
 */
import { describe, expect, it } from 'vitest';
import { diffValues, stripIgnored } from '../scripts/sync-vapi-squad';

describe('diffValues', () => {
  it('reports no diff for identical primitive values', () => {
    const out: string[] = [];
    diffValues('Claims_Agent.model.temperature', 0.1, 0.1, out);
    expect(out).toEqual([]);
  });

  it('reports no diff for identical nested objects', () => {
    const out: string[] = [];
    diffValues('Claims_Agent', { model: { temperature: 0.1 } }, { model: { temperature: 0.1 } }, out);
    expect(out).toEqual([]);
  });

  it('does not throw when a field exists in repo but not live (undefined liveVal)', () => {
    const out: string[] = [];
    expect(() => {
      diffValues('Claims_Agent.knownResubmissionChannel', 'fax to 555-0100', undefined, out);
    }).not.toThrow();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('repo: fax to 555-0100');
    expect(out[0]).toContain('live: (missing)');
  });

  it('does not throw when a field exists live but not in repo (undefined repoVal)', () => {
    const out: string[] = [];
    expect(() => {
      diffValues('Claims_Agent.someLegacyField', undefined, 'left over from a manual dashboard edit', out);
    }).not.toThrow();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('repo: (missing)');
    expect(out[0]).toContain('live: left over from a manual dashboard edit');
  });

  it('recurses through nested objects without throwing when a nested field is undefined on one side', () => {
    const out: string[] = [];
    expect(() => {
      diffValues(
        'Claims_Agent',
        { model: { temperature: 0.1, newField: 'value' } },
        { model: { temperature: 0.1 } },
        out,
      );
    }).not.toThrow();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('Claims_Agent.model.newField');
  });

  it('reports a diff for two different defined values', () => {
    const out: string[] = [];
    diffValues('Claims_Agent.model.temperature', 0.1, 0.2, out);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('repo: 0.1');
    expect(out[0]).toContain('live: 0.2');
  });

  it('truncates long string values instead of dumping the full prompt text', () => {
    const out: string[] = [];
    const long = 'x'.repeat(200);
    diffValues('Claims_Agent.systemPrompt', long, 'short', out);
    expect(out[0]).toContain('...');
    expect(out[0]).not.toContain('x'.repeat(200));
  });
});

describe('stripIgnored', () => {
  it('removes server-managed fields but keeps everything else', () => {
    const result = stripIgnored({
      id: 'abc-123',
      orgId: 'org-456',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      isServerUrlSecretSet: true,
      name: 'Claims_Agent',
      firstMessage: 'Hello',
    });
    expect(result).toEqual({ name: 'Claims_Agent', firstMessage: 'Hello' });
  });
});
