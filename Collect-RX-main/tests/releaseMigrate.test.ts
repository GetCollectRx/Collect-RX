import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs script, no type declarations
import { failedMigrations, pendingMigrations, evaluate } from '../scripts/release-migrate.mjs';

describe('release-migrate preflight', () => {
  it('finds only migrations that started, never finished, and were not rolled back', () => {
    const rows = [
      { migration_name: 'a', finished_at: new Date(), rolled_back_at: null },
      { migration_name: 'b', finished_at: null, rolled_back_at: null },
      { migration_name: 'c', finished_at: null, rolled_back_at: new Date() },
    ];
    expect(failedMigrations(rows)).toEqual(['b']);
    expect(failedMigrations(undefined)).toEqual([]);
  });

  it('lists on-disk migrations the database has not applied, sorted', () => {
    expect(pendingMigrations(['3', '1', '2'], ['1'])).toEqual(['2', '3']);
    expect(pendingMigrations(['1'], ['1'])).toEqual([]);
  });

  it('blocks on a failed migration and names the repair command', () => {
    const r = evaluate({ role: 'app', canCreate: true, failed: ['20260811180000_x'], pending: [] });
    expect(r.block).toBe(true);
    expect(r.messages.join('\n')).toContain('migrate resolve --rolled-back 20260811180000_x');
  });

  it('blocks when CREATE on public is missing and migrations are pending (the Oct 2 failure)', () => {
    const r = evaluate({ role: 'app', canCreate: false, failed: [], pending: ['20261117120000_y'] });
    expect(r.block).toBe(true);
    expect(r.messages.join('\n')).toContain('GRANT USAGE, CREATE ON SCHEMA public TO "app"');
  });

  it('only warns when CREATE is missing but nothing is pending', () => {
    const r = evaluate({ role: 'app', canCreate: false, failed: [], pending: [] });
    expect(r.block).toBe(false);
    expect(r.messages[0]).toContain('WARNING');
  });

  it('passes a healthy database silently', () => {
    expect(evaluate({ role: 'app', canCreate: true, failed: [], pending: ['z'] })).toEqual({ block: false, messages: [] });
  });
});
