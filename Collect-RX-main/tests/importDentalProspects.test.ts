/**
 * Prospect import tests — the enrichment file must agree with the vetted prospect CSV.
 *
 * The original import silently dropped every enriched entry that matched no CSV row, so a file
 * where 74% of entries were off-list still produced a campaign that claimed to hold 101
 * practices. These tests pin the refusal and the quoted-CSV parsing.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import {
  buildImportPlan,
  assertPlanIsSane,
  parseEnrichedFile,
} from '../scripts/import-dental-prospects.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CSV = [
  'Practice Name,Owner / Principal (likely),Dentists on staff,Address,City,Postal Code,Segment,Suggested Tier,General Email (to enrich),Outreach Status',
  'Kingsview Dental,Dr. Kelsey Li,"Dr. Kelsey Li, Dr. Alida Andersen",339 King Street West,Toronto,M5V 1J5,Group,Growth,,',
  'Riverbend Dental,Dr. Amara Nguyen,Dr. Amara Nguyen,"88 Bay Street, Suite 300",Toronto,M5J 2T3,Prime,Scale,,',
  'Hillcrest Dental,Dr. Sam Okafor,Dr. Sam Okafor,12 Elm Road,Ottawa,K1A 0A1,Solo,Core,,',
].join('\n');

function enrichedFile(prospects: Array<{ practice_name: string; city: string; email: string }>): string {
  return JSON.stringify({ enrichment_summary: { emails_verified: false }, prospects });
}

describe('parseEnrichedFile', () => {
  it('rejects a file without a prospects array', () => {
    expect(() => parseEnrichedFile(JSON.stringify({ batch_1: [] }))).toThrow(/prospects/);
  });

  it('rejects entries missing a required field', () => {
    const json = JSON.stringify({ prospects: [{ practice_name: 'Kingsview Dental', city: 'Toronto' }] });
    expect(() => parseEnrichedFile(json)).toThrow(/practice_name, city and email/);
  });

  it('reports emails_verified only when explicitly true', () => {
    expect(parseEnrichedFile(JSON.stringify({ prospects: [] })).emailsVerified).toBe(false);
    expect(
      parseEnrichedFile(JSON.stringify({ enrichment_summary: { emails_verified: true }, prospects: [] }))
        .emailsVerified,
    ).toBe(true);
  });
});

describe('buildImportPlan', () => {
  it('matches enriched entries to CSV rows and carries the CSV metadata', () => {
    const enriched = enrichedFile([
      { practice_name: 'Kingsview Dental', city: 'Toronto', email: 'info@kingsview.ca' },
    ]);

    const plan = buildImportPlan(CSV, enriched, 'campaign-1');

    expect(plan.csvRows).toBe(3);
    expect(plan.prospects).toHaveLength(1);
    const [p] = plan.prospects;
    expect(p.practiceName).toBe('Kingsview Dental');
    expect(p.email).toBe('info@kingsview.ca');
    expect(p.city).toBe('Toronto');
    expect(p.contactName).toBe('Dr. Kelsey Li');
    expect(p.campaignId).toBe('campaign-1');
    expect(p.metadata).toMatchObject({ postalCode: 'M5V 1J5', segment: 'Group', tier: 'Growth' });
  });

  it('keeps commas inside quoted CSV fields out of the column mapping', () => {
    // The old split(',') parse shifted every column after "Dentists on staff", which put a
    // fragment of the staff list into Address and the address into City.
    const enriched = enrichedFile([
      { practice_name: 'Riverbend Dental', city: 'Toronto', email: 'hello@riverbend.ca' },
    ]);

    const [p] = buildImportPlan(CSV, enriched, 'c').prospects;

    expect(p.city).toBe('Toronto');
    expect(p.metadata).toMatchObject({ address: '88 Bay Street, Suite 300', postalCode: 'M5J 2T3' });
  });

  it('is case-insensitive on practice name', () => {
    const enriched = enrichedFile([
      { practice_name: 'kingsview dental', city: 'Toronto', email: 'info@kingsview.ca' },
    ]);

    expect(buildImportPlan(CSV, enriched, 'c').prospects).toHaveLength(1);
  });

  it('collects off-list entries instead of importing them', () => {
    const enriched = enrichedFile([
      { practice_name: 'Kingsview Dental', city: 'Toronto', email: 'info@kingsview.ca' },
      { practice_name: 'Elmira Dental', city: 'Elmira', email: 'info@elmira.ca' },
      { practice_name: 'Woolwich Dental', city: 'Woolwich', email: 'info@woolwich.ca' },
    ]);

    const plan = buildImportPlan(CSV, enriched, 'c');

    expect(plan.prospects).toHaveLength(1);
    expect(plan.offListNames).toEqual(['Elmira Dental', 'Woolwich Dental']);
  });

  it('scores by segment', () => {
    const enriched = enrichedFile([
      { practice_name: 'Riverbend Dental', city: 'Toronto', email: 'a@b.ca' },
      { practice_name: 'Kingsview Dental', city: 'Toronto', email: 'c@d.ca' },
      { practice_name: 'Hillcrest Dental', city: 'Ottawa', email: 'e@f.ca' },
    ]);

    const scores = Object.fromEntries(
      buildImportPlan(CSV, enriched, 'c').prospects.map((p) => [p.practiceName, p.score]),
    );

    expect(scores['Riverbend Dental']).toBe(80); // Prime
    expect(scores['Kingsview Dental']).toBe(70); // Group
    expect(scores['Hillcrest Dental']).toBe(60); // Solo
  });
});

describe('assertPlanIsSane', () => {
  const matched = { practice_name: 'Kingsview Dental', city: 'Toronto', email: 'info@kingsview.ca' };

  it('refuses a plan containing off-list entries', () => {
    const enriched = enrichedFile([matched, { practice_name: 'Elmira Dental', city: 'Elmira', email: 'x@y.ca' }]);
    const plan = buildImportPlan(CSV, enriched, 'c');

    expect(() => assertPlanIsSane(plan)).toThrow(/match no row in the prospect CSV/);
    expect(() => assertPlanIsSane(plan)).toThrow(/Elmira Dental/);
  });

  it('refuses malformed addresses', () => {
    const enriched = enrichedFile([{ ...matched, email: 'not-an-email' }]);

    expect(() => assertPlanIsSane(buildImportPlan(CSV, enriched, 'c'))).toThrow(/Malformed addresses/);
  });

  it('refuses an empty recipient list', () => {
    expect(() => assertPlanIsSane(buildImportPlan(CSV, enrichedFile([]), 'c'))).toThrow(/No prospects to import/);
  });

  it('accepts a plan where every enriched entry is on the list', () => {
    expect(() => assertPlanIsSane(buildImportPlan(CSV, enrichedFile([matched]), 'c'))).not.toThrow();
  });
});

describe('committed prospect data', () => {
  it('enriched_emails.json contains only practices from the vetted CSV', () => {
    const csvText = fs.readFileSync(path.join(repoRoot, 'outreach/dental-prospects-ottawa-gta.csv'), 'utf-8');
    const enrichedJson = fs.readFileSync(path.join(repoRoot, 'enriched_emails.json'), 'utf-8');

    const plan = buildImportPlan(csvText, enrichedJson, 'audit');

    expect(plan.offListNames).toEqual([]);
    expect(plan.invalidEmails).toEqual([]);
    expect(plan.prospects.length).toBeGreaterThan(0);
    expect(() => assertPlanIsSane(plan)).not.toThrow();
  });

  it('assigns each address to exactly one practice', () => {
    const csvText = fs.readFileSync(path.join(repoRoot, 'outreach/dental-prospects-ottawa-gta.csv'), 'utf-8');
    const enrichedJson = fs.readFileSync(path.join(repoRoot, 'enriched_emails.json'), 'utf-8');

    const emails = buildImportPlan(csvText, enrichedJson, 'audit').prospects.map((p) => p.email);

    expect(new Set(emails).size).toBe(emails.length);
  });
});
