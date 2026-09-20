/**
 * Imports the vetted Ottawa + GTA dental prospect list into a marketing campaign.
 *
 * The prospect CSV is the source of truth for *who* is on the list; enriched_emails.json
 * only supplies contact addresses for rows already on it. An enriched entry with no
 * matching CSV row means the enrichment drifted off-list, so the import refuses to run
 * rather than quietly seeding a campaign with unvetted recipients.
 *
 * Usage:
 *   tsx scripts/import-dental-prospects.ts --dry-run   # print recipients, write nothing
 *   tsx scripts/import-dental-prospects.ts             # import (requires DATABASE_URL)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient, type Prisma } from '@prisma/client';
import { parseSimpleCsv } from '../src/server/csv/parseSimple.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

const ENRICHED_PATH = path.join(repoRoot, 'enriched_emails.json');
const CSV_PATH = path.join(repoRoot, 'outreach/dental-prospects-ottawa-gta.csv');

const CAMPAIGN_NAME = 'Ottawa + GTA Dental Practices Q3 2026';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EnrichedProspect {
  practice_name: string;
  city: string;
  email: string;
}

export interface ImportPlan {
  prospects: Prisma.ProspectCreateManyInput[];
  csvRows: number;
  enrichedEntries: number;
  /** Enriched entries with no corresponding row in the prospect CSV — always a data fault. */
  offListNames: string[];
  invalidEmails: string[];
  emailsVerified: boolean;
}

function isEnrichedProspect(value: unknown): value is EnrichedProspect {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.practice_name === 'string' &&
    typeof row.city === 'string' &&
    typeof row.email === 'string'
  );
}

export function parseEnrichedFile(json: string): { prospects: EnrichedProspect[]; emailsVerified: boolean } {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('enriched_emails.json: expected a JSON object');
  }

  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.prospects)) {
    throw new Error('enriched_emails.json: expected a "prospects" array');
  }

  const prospects = root.prospects.filter(isEnrichedProspect);
  if (prospects.length !== root.prospects.length) {
    throw new Error('enriched_emails.json: every prospect needs practice_name, city and email');
  }

  const summary = root.enrichment_summary;
  const emailsVerified =
    typeof summary === 'object' &&
    summary !== null &&
    (summary as Record<string, unknown>).emails_verified === true;

  return { prospects, emailsVerified };
}

function scoreForSegment(segment: string): number {
  if (segment === 'Prime') return 80;
  if (segment.startsWith('Group')) return 70;
  return 60;
}

export function buildImportPlan(csvText: string, enrichedJson: string, campaignId: string): ImportPlan {
  const { prospects: enriched, emailsVerified } = parseEnrichedFile(enrichedJson);
  const csvRows = parseSimpleCsv(csvText).filter((row) => row.practice_name && row.city);

  const byName = new Map(csvRows.map((row) => [row.practice_name.toLowerCase(), row]));

  const prospects: Prisma.ProspectCreateManyInput[] = [];
  const offListNames: string[] = [];
  const invalidEmails: string[] = [];

  for (const entry of enriched) {
    const csvRow = byName.get(entry.practice_name.trim().toLowerCase());
    if (!csvRow) {
      offListNames.push(entry.practice_name);
      continue;
    }
    if (!EMAIL_PATTERN.test(entry.email)) {
      invalidEmails.push(`${entry.practice_name}: ${entry.email}`);
      continue;
    }

    const segment = csvRow.segment ?? '';
    prospects.push({
      practiceName: csvRow.practice_name,
      contactName: csvRow['owner_/_principal_(likely)'] ?? '',
      email: entry.email,
      city: csvRow.city,
      province: 'ON',
      score: scoreForSegment(segment),
      stage: 'new',
      source: 'manual',
      campaignId,
      metadata: {
        tier: csvRow.suggested_tier ?? '',
        segment,
        postalCode: csvRow.postal_code ?? '',
        address: csvRow.address ?? '',
      },
    });
  }

  return {
    prospects,
    csvRows: csvRows.length,
    enrichedEntries: enriched.length,
    offListNames,
    invalidEmails,
    emailsVerified,
  };
}

/** Throws when the enrichment file disagrees with the vetted list badly enough to distrust it. */
export function assertPlanIsSane(plan: ImportPlan): void {
  if (plan.offListNames.length > 0) {
    throw new Error(
      `${plan.offListNames.length} of ${plan.enrichedEntries} enriched entries match no row in ` +
        `the prospect CSV. Importing would email practices that were never vetted.\n` +
        `  ${plan.offListNames.slice(0, 10).join('\n  ')}` +
        (plan.offListNames.length > 10 ? `\n  ...and ${plan.offListNames.length - 10} more` : ''),
    );
  }
  if (plan.invalidEmails.length > 0) {
    throw new Error(`Malformed addresses in enriched_emails.json:\n  ${plan.invalidEmails.join('\n  ')}`);
  }
  if (plan.prospects.length === 0) {
    throw new Error('No prospects to import — enriched_emails.json matched nothing in the CSV.');
  }
}

function printPlan(plan: ImportPlan, dryRun: boolean): void {
  const coverage = ((plan.prospects.length / plan.csvRows) * 100).toFixed(0);
  console.log(`\nCampaign: ${CAMPAIGN_NAME}`);
  console.log(
    `Recipients: ${plan.prospects.length} of ${plan.csvRows} CSV practices have a contact address (${coverage}% coverage)`,
  );

  if (!plan.emailsVerified) {
    console.warn(
      '\n  These addresses came from automated web lookup and are NOT individually confirmed.\n' +
        '  Read the list below before sending — bounces from guessed addresses damage the\n' +
        '  sending domain reputation for every later campaign.',
    );
  }

  console.log('');
  for (const p of plan.prospects) {
    console.log(`  ${(p.city ?? '').padEnd(12)} ${p.practiceName.padEnd(38)} ${p.email ?? ''}`);
  }

  console.log(
    dryRun
      ? '\nDry run — nothing was written. Re-run without --dry-run to import.\n'
      : '\nImporting...\n',
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run') || !process.env.DATABASE_URL;

  for (const [label, file] of [['Enriched emails', ENRICHED_PATH], ['Prospect CSV', CSV_PATH]] as const) {
    if (!fs.existsSync(file)) {
      console.error(`${label} not found at ${file}`);
      process.exit(1);
    }
  }

  const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
  const enrichedJson = fs.readFileSync(ENRICHED_PATH, 'utf-8');

  // A placeholder id keeps the plan buildable (and printable) before any campaign row exists.
  const plan = buildImportPlan(csvText, enrichedJson, '');

  try {
    assertPlanIsSane(plan);
  } catch (err) {
    console.error(`\nRefusing to import: ${(err as Error).message}\n`);
    process.exit(1);
  }

  printPlan(plan, dryRun);

  if (dryRun) {
    if (!process.env.DATABASE_URL) {
      console.log('(DATABASE_URL is unset, so this defaulted to a dry run.)\n');
    }
    return;
  }

  const prisma = new PrismaClient();
  try {
    const campaign = await prisma.marketingCampaign.create({
      data: {
        name: CAMPAIGN_NAME,
        targetProvinces: ['ON'],
        notes: `Cold outreach to ${plan.prospects.length} vetted Ottawa/GTA dental practices with enriched contact addresses.`,
        active: true,
      },
    });

    const rows = plan.prospects.map((p) => ({ ...p, campaignId: campaign.id }));
    const created = await prisma.prospect.createMany({ data: rows, skipDuplicates: true });

    console.log(`Imported ${created.count} prospects into campaign ${campaign.name} (${campaign.id}).`);
    console.log('\nNext: Admin > Campaign Manager to review, then let the scheduler send.');
    console.log('The scheduler will refuse to send until MAILING_ADDRESS and SENDER_PHONE are set.\n');
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error('Import failed:', (err as Error).message);
    process.exit(1);
  });
}
