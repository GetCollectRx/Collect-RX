import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Contract test (source level). The retention purge must never touch breach
// records, which are kept at least BREACH_RETENTION_MONTHS (W4, T18). A database
// test with seeded rows is still outstanding (see the PR body).
const root = join(__dirname, '..', '..');
const job = readFileSync(join(root, 'src/server/jobs/dataRetentionJob.ts'), 'utf8');

describe('retention job breach exemption (contract)', () => {
  it('never references the breach register model or table', () => {
    expect(job).not.toMatch(/phipaBreachNotification/);
    expect(job).not.toMatch(/PHIPABreachNotification/);
      });

  it('documents the exemption so a future sweep does not add it silently', () => {
    expect(job).toMatch(/PHIPA breach register is kept at least 24 months/);
  });
});
