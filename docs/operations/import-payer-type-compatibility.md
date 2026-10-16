# Import payer-type compatibility plan

Status: Step 1 (draft PR #121). Not released. Release is gated on V1 and on the connector configuration step below.

## Why this exists

Dispatch now refuses CDCP and provincial claims (DEC-10). A claim therefore has to carry a payer program from the moment it is imported. Before this change, imports never set one, and the carrier map sent `cdcp` and `cdcp_sunlife` exports to `sun_life`, so a CDCP claim could be dialed as private Sun Life.

Rule for new imports: a NEW claim without a payer program is rejected with a visible reason. It is never silently defaulted to PRIVATE. Existing claims that already have a program are never reclassified by an import. Existing claims with a null program keep the approved treatment (dialed as PRIVATE, logged and flagged `payerTypeAssumed`).

## Affected clients

| Client | Entry point | What changes | Operator action |
|---|---|---|---|
| CSV import wizard | `/import` | Preview shows counts per program. A program selector appears only when some rows have none. Import is disabled until every row is classified or a program is chosen. Bad values and conflicts block with row numbers. | None, once staff pick a program for files with no payer column |
| Admin Sync ops upload | `/admin/sync` | Same classification summary and selector. Upload is blocked with a message until resolved. | Same |
| Group batch import | `POST /api/group/pms-import`, `/group/pms-import` page | Each entry takes its own `defaultPayerType`. Entries with unclassified rows and no declaration are rejected individually. | Group admins choose per practice entry |
| AbelDent desktop connector | `POST /api/connector/claims/import` | AbelDent data has no payer field. The connector now sends `defaultPayerType` from `COLLECTRX_DEFAULT_PAYER_TYPE`. Without it, new claims are rejected and the heartbeat says why. Existing claims keep updating. | Set the variable on each connected practice machine. Shipping the new sender needs an installer release (signed build only) |
| Scripted API callers | `POST /api/admin/sync/import/:vendor`, `POST /api/insurance/claims/import` | Request must include a per-row `payerType` or a body/form `defaultPayerType`. Otherwise new claims are rejected. | Update the script |

Affected clients are enumerated from code. How many live practices use each path is unverified (V8, no production access). Confirming usage is a release prerequisite, not an assumption.

## How a row is classified (precedence)

1. Row payer type column (headers "Payer Type", "Payer Program", "Plan Type", "Funding Type" or `payer_type`; accepted values and aliases are in `src/lib/payerTypeInput.ts`).
2. Plan name that says CDCP (for example "Sun Life CDCP"). A conflicting explicit column value (PRIVATE with a CDCP plan name) is rejected, not resolved silently.
3. File-level declared default (`defaultPayerType`, the wizard selector, connector env var).
4. Otherwise rejected for a new claim.

Unrecognized values (for example "medicare") are rejected with the row number and the offending value. The same logic runs in the browser preview and on the server (`src/lib/payerTypeInput.ts`), so the preview cannot disagree with the import.

## Mixed-program files

A file can mix private, CDCP and provincial rows. Rows with an explicit value or a CDCP plan name keep their own program. The declared default applies only to rows that have neither. Verified in the browser with synthetic files: a mixed file of 2 private, 2 CDCP (one from the plan name), 1 provincial and 1 unclassified row asked about exactly the one unclassified row, and the database showed CDCP and provincial claims classified and not queued for calling.

## Supported transition

1. Before release, confirm which practices import through which path (V8).
2. Tell staff using the wizard or Sync ops: add a payer type column, or pick a program when asked.
3. For each AbelDent practice, decide the program for the connector (almost always PRIVATE) and set `COLLECTRX_DEFAULT_PAYER_TYPE`. Roll the installer first. Until the practice has both, new AbelDent claims are held out of the queue (visible, not lost), and existing claims continue.
4. Update any scripted callers.
5. Existing null-program claims: no action required; they remain visibly flagged. A later backfill is a separate decision.

## Full export confirmation (DEC-14, slice 1)

The wizard no longer assumes the file lists every open claim. The operator must choose "all of our open insurance claims" or "only some of them", with neither preselected. On "all", the wizard asks the server which open claims the file does not list (`POST /api/admin/sync/import/:vendor/absence-preview`, which changes nothing), shows the count and a few claim numbers, and requires an explicit confirmation before Import is enabled. The import sends the confirmed count back; if the count differs at import time the server returns 409 `ABSENT_CLAIMS_CHANGED` and imports nothing. The mass-absence guard (10 or more claims and over half of all open claims) still holds a filtered file even when confirmed.

API callers are unchanged: `exportScope` defaults to `partial`, and `confirmedMissingCount` is optional. Only the wizard ever sent `full`; Sync ops, the group batch import and the AbelDent connector never did.

### Claims not in the latest file (DEC-14, slice 2)

A claim a confirmed full export leaves out is paused (recovery route STOP, event `ABSENT_FROM_FULL_EXPORT`) and listed under **Not in latest file** (`/not-in-latest-file`, practice owner menu). Nothing resolves or resumes it on a timer, because absence from a file is not evidence the claim was paid. The practice owner can:

- **Confirm resolved**: the claim stays closed (event `ABSENT_CONFIRMED_RESOLVED`, with the deciding user id).
- **Put back into follow-up**: the claim returns to the route it had before (event `ABSENT_RESTORED_BY_STAFF`) and the call queue is re-synced.

Rules: only a claim whose newest event is still `ABSENT_FROM_FULL_EXPORT` can be decided, so a second decision is a no-op; another practice's claim ids are skipped; the list carries claim number, carrier, amount, days outstanding and the date it was left out, and no patient information. A claim that reappears in a later file with a balance resumes on its own (`REAPPEARED_IN_EXPORT`) unless staff already confirmed it resolved. API: `GET /api/claims-not-in-latest-file` and `POST /api/claims-not-in-latest-file/decision`, both requiring the literal `practice_owner` session role.

Existing data: practices that already ran full exports have claims marked `ABSENT_FROM_FULL_EXPORT`. Those claims were closed without a decision, so they appear in this list on release and need the owner's review. Check how many exist per practice before release.

## Release prerequisites for this area

- V1 confirmed.
- V8 usage confirmed per path.
- Connector installer released and `COLLECTRX_DEFAULT_PAYER_TYPE` set for each AbelDent practice, or those practices informed that new claims will be rejected.
- Group admin import page not exercised in a browser (needs a group admin account); covered by server tests only.

## Evidence

Synthetic-file browser run: `ui-results.json` (19 of 19 checks pass), screenshots, and the CSV inputs are in the evidence archive.
