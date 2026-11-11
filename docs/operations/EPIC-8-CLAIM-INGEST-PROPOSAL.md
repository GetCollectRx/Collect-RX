# Epic 8 proposal: claim ingest with no staff time, any system, any vertical

Status: PROPOSAL for Khalid's decision. Written 2026-11-11. Nothing here is built.

## Why this epic exists

The PRD says each vertical has "claim fields and import mapping" and nothing more. The product promise is no staff time, but the only feeds in the code today are:

| Feed | State |
|---|---|
| CSV upload in the browser | Works on the server (self-test). A person must export and upload every time. |
| AbelDent desktop agent (reads the local SQL Server database every 15 minutes) | Hands-off, but AbelDent only, and never run against a real install. |
| Other vendors in `pmsRegistry.ts` | Labels only. They fall back to CSV. |

For the stated goal (insurance-facing businesses in all three PRD lanes, no vendor APIs), there is no feed today for any practice that is not AbelDent.

## Requirement

A claim reaches CollectRx with no staff action after one-time setup, from any source system, in any vertical. A stopped or broken feed is noticed by us before the customer notices.

Acceptance:

1. A synthetic business in each of three source styles (local database, scheduled report file, cloud-only system with manual export) is fed into the app with zero clicks after setup, in a contained test.
2. A claim marked paid at the source stops being chased within one feed cycle.
3. A feed silent for longer than its expected interval raises an alert to us, and a customer notice after a second interval.
4. A changed report layout is held in quarantine with a reason. It is never imported wrongly.
5. No patient or insured name, date of birth or identifier appears in logs or Vapi metadata from the feed path.

## Options

| Option | How it works | Covers | Does not cover | Effort |
|---|---|---|---|---|
| A. Scheduled report pickup | The source system saves its own outstanding-claims report on a schedule to a folder. A small agent on the customer's computer watches the folder and uploads each new file through the existing import pipeline. | Any system that can schedule a report, including many cloud systems that email or save reports. | Systems that only offer manual export. | Medium |
| B. Pluggable database agent | The AbelDent agent generalised: one agent, one driver per database type, a per-customer mapping built by schema discovery. | Systems with a queryable local database. | Cloud-only systems; proprietary stores. | Large per vendor |
| C. Better manual upload | Saved column mapping per customer, a preview showing what changed, reminders when an upload is stale. | Everything, with staff effort. | The no-staff-time promise. | Small |
| D. Payer-side sources | Use what the payer already sends the business (for example remittance or claim-status files). Not investigated. | Possibly every vertical. | Unknown. | Unknown, research first |

## Recommendation (hedged)

1. Build A as the default hands-off feed, with C as the guaranteed fallback so nobody is blocked.
2. Keep B for AbelDent only, not generalised, until a customer needs another database.
3. Run a research spike on D before committing to more agent work.

Everything below the pipeline already exists and stays shared: `runPmsImportPipeline`, quarantine, work-queue sync. Only the front of the funnel changes.

## What I do not know

| Unknown | How to resolve |
|---|---|
| Whether the first practices' systems can schedule a report at all | Ask the pilots, or check the vendors' public documentation. |
| What auto, restoration, DME and NEMT businesses run, and what they can export | Workflow cards per vertical (PRD lane research). |
| Whether option D is accessible to a business without vendor cooperation | Research spike. |
| Whether the customer will install an agent on a work computer | A customer conversation. |

## Test plan (contained, no real customer)

Fake source folder with synthetic reports in three layouts, a fake local database, an agent run against both, the real import pipeline, the real queue engine, and the feed-silence alert. All data synthetic, all egress blocked by the self-test guard.

## Decisions needed

1. Approve option A plus C as the build, and D as research.
2. Confirm whether an on-premises agent is acceptable to customers.
