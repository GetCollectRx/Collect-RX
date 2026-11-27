# Pilot operations drafts, 2026-11-12

Drafts for B-15, B-20, B-21, B-22 and B-28. No counsel is involved for now, so each draft leans conservative: when unsure, do less, store less, and ask the practice. These are working drafts, not signed policy.

## B-15 Trial limits (proposal)
- Today: 500 minutes per month, 50 per day. At about 25 billed minutes per attempt that is 20 attempts and 2 a day, too few to show value.
- Proposal: keep the 30-day trial and the 500-minute cap, drop the daily cap to 100 (4 attempts a day) so a first week can show results. Cost check: 500 min x $0.135 = $67.50 per trial, under the $159.60 (40 percent of $399) cost ceiling already in the tests.
- Not applied. Limits live in `src/billing/tiers.ts`.

## B-20 Carrier terms review checklist
For each of Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare:
1. Find the provider or portal terms and any telephone-service terms. Record the URL and the date read.
2. Answer: does it prohibit automated or recorded calling, or calling for a third party? Is a Billing Agent Authorization letter required, and what does it allow?
3. Mark the carrier ENABLE, ENABLE WITH LIMITS (state them), or HOLD. Default is HOLD until read.
4. Keep the carrier disabled per practice in settings until marked ENABLE (`carrierConfigs[].enabled` already gates dispatch).

## B-21 Vendor and ops checklist
- Vendors that touch call data: Vapi, Twilio, hosting (Fly.io), database, email, Stripe. For each: data-processing terms on file, data region, retention setting, and whether recording or transcription is switched off.
- Penetration test or a written exception with the reason.
- Backup restore tested once, with the date and time taken to restore.
- On-call: who is paged, how, and the fallback if that person is unreachable (solo founder: set an auto-reply and a status page line).
- Error tracking (Sentry) on, with PHI scrubbing confirmed on a test event.

## B-22 Deletion and exit process (draft)
1. Practice requests exit in writing from the owner account.
2. Within 2 business days: pause calling, export their claims and outcomes (CSV), send it to the owner.
3. Within 30 days: delete patient data, call logs and transcripts for that practice; keep only billing records the business must keep.
4. Confirm deletion to the owner in writing with the date.
5. Log the request and completion in the audit log. Never delete another practice's rows; run deletes scoped by practice id and count rows before and after.

## B-28 Support promise and incident comms
- Promise (pilot): replies on business days within 4 hours, 9 to 5 Eastern; carrier blocks and outages acknowledged within 1 hour.
- Template, carrier block: "We paused calls to <carrier> for your practice because the carrier flagged automated calling. No claims were changed. We will review and tell you by <time> whether calls resume."
- Template, outage: "CollectRx calling is paused due to a service problem. Claims in progress were not changed. Next update by <time>."
- Template, bad handoff: "A call to <carrier> was not handed to your front desk in time. The rep's reference number is <ref> if given. We are sorry; the minutes are credited."
- Tabletop drill (30 minutes): walk one carrier block and one outage end to end; time how long until the practice is told. Record gaps.
