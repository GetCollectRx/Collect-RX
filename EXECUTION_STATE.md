# Campaign Execution State

**Updated:** July 29, 2026
**Goal:** 10 dental practices onboarded
**Current status:** infrastructure ready, 20 vetted recipients staged, 0 emails sent

## What's done

- Campaign system built (scheduler, templates, API, dashboard)
- 151-practice prospect list: `outreach/dental-prospects-ottawa-gta.csv`
- Database migration file: `Collect-RX-main/prisma/migrations/20260721_add_email_campaign_fields/`
- CASL footer wired into scheduler emails, with a working reply path
- Import pipeline reads `enriched_emails.json` and refuses unvetted recipients

## Corrections applied July 29

The enrichment output did not match its own summary, and the campaign would have sent a
fabricated mailing address. Both are fixed:

- **`enriched_emails.json` claimed 102 enriched practices across 4 batches.** It held 76
  entries across 3 batches, and only 20 of them matched a row in the prospect CSV — the
  other 56 were practices in Ottawa suburbs and southwestern Ontario that were never on the
  vetted list. It now holds the 20 matched practices only. The 56 rejects are preserved in
  `outreach/enrichment-rejected.json` as a worklist, not deleted.
- **The scheduler defaulted `MAILING_ADDRESS` to a fake street address** and `SENDER_PHONE`
  to a fake number, so an unconfigured deploy would have put invented contact details in the
  CASL footer of every email. Both are now required; the campaign refuses to send without
  them, and the admin send-batch endpoint returns 503 with the reason.
- **The import script parsed the CSV with `split(',')`**, which corrupted every quoted field
  (staff lists, multi-part addresses). It now uses `parseSimpleCsv`.
- The import script also ran on `__dirname` under an ESM package, so it could not execute at
  all.

## Before any send

1. **Set a real `MAILING_ADDRESS` and `SENDER_PHONE` on Fly.** CASL requires a genuine
   mailing address in every commercial message. A PO box qualifies. Nothing sends until both
   are set — this is enforced, not advisory.
2. **Review the 20 recipients by hand.** The addresses came from automated web lookup and are
   not individually confirmed; most follow an `info@<domain>` pattern and some may not exist.
   Hard bounces damage the sending domain's reputation for every later campaign.
   ```bash
   cd Collect-RX-main && npx tsx scripts/import-dental-prospects.ts --dry-run
   ```

## Execution steps

```bash
# 1. Migration
fly ssh console -a collect-rx
psql -d $DATABASE_URL -f prisma/migrations/20260721_add_email_campaign_fields/migration.sql

# 2. Dry run — read the recipient list before writing anything
npx tsx scripts/import-dental-prospects.ts --dry-run

# 3. Import (requires DATABASE_URL; without it the script dry-runs by default)
npx tsx scripts/import-dental-prospects.ts

# 4. Verify sending is unblocked and working
fly logs -a collect-rx | grep emailCampaignScheduler
#    "not sending — MAILING_ADDRESS ... is required"  → secrets still unset
#    "Sent N emails"                                  → sending
```

Then confirm sent-vs-bounced in the SendGrid Activity feed before releasing the next batch.
The scheduler sends at most 10 emails per 5-minute run.

## Open work

- **~130 practices still have no contact address.** Re-enrichment was deferred, not
  completed. `outreach/enrichment-rejected.json` plus the unmatched CSV rows are the
  worklist. Any future enrichment must be checked against the CSV before import — the import
  now fails loudly if it isn't, which is how the earlier drift would have been caught.
- **Repo hygiene:** 431 tracked files are `" 2"`-suffixed Finder duplicates (e.g.
  `emailCampaignScheduler 2.ts`). They are dead but tracked, so fixes have to be mirrored
  into them. Worth a dedicated cleanup commit.

## Success criteria

- At least one email confirmed delivered to a real practice address in the SendGrid Activity
  feed — delivered, not merely accepted
- 10 practices at `stage: 'closed_won'` with `closedWonAt` set
