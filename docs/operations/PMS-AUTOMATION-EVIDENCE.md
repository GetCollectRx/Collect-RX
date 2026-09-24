# PMS export/scheduling automation — evidence and design

Point-in-time record (2026-09-24) of what was verified, by code inspection and vendor
documentation, about removing recurring manual PMS export/upload steps. Treat this the
way [`CLAUDE.md`](../../CLAUDE.md) treats dated documents: a record of what was true when
written, not a living status page. Re-verify vendor claims before relying on them —
vendor integration programs and product tiers change without notice.

## What was investigated

Full runtime trace: local desktop jobs (`Collect-RX-main/desktop/`, `electron-shell/`),
the PMS connector registry (`Collect-RX-main/src/server/pms/pmsRegistry.ts`), the CSV
upload/import routes (`pmsSyncRoutes.ts`, `connectorRoutes.ts`), claim matching and
persistence (`prismaClaimImporter.ts`), and payment verification
(`paymentVerification.ts`, `transitionClaimRecovery.ts`).

**Confirmed before this change**: the only PMS with a working local sync agent was
AbelDent, and that agent reads a **live SQL Server connection** directly
(`desktop/services/abeldent-sync.cjs`), not a file export. No folder-watching,
file-discovery, or drop-folder mechanism existed anywhere in the repository. CSV import
for every other vendor was a manual, session-authenticated browser upload only.

## Evidence table — PMS export/scheduling capability

Sources are vendor documentation and vendor-adjacent third-party writeups, checked
2026-09-24. None of these were verified against a live install of the PMS in question —
"confirmed" below means "documented by the vendor," not "tested by CollectRx."

| PMS | Export/scheduling capability found | Automation status |
|---|---|---|
| AbelDent (Local Plus) | Local SQL Server database CollectRx already queries live. No public documentation of a report scheduler or auto-export-to-folder feature. Vendor is migrating customers to "ABELDent Cloud (v15)," which would break the on-prem SQL Server model. | **Confirmed** (already automated via live DB pull) — Cloud migration is a live risk to re-verify |
| Open Dental | Documented, self-serve developer API (Developer + Customer API keys, Developer Portal), mediated by a locally-running `eConnector` process. Direct read-only MySQL access is explicitly called "generally safe" by Open Dental's own docs. No documented scheduled-file-export feature — the API is pull-based. | **Needs configuration** — realistic to build a CollectRx-initiated API-pull connector; not built here |
| Dentrix (G7) | Official Read/Write/Scheduling/Claims-Summary APIs exist but require a locally installed desktop agent as intermediary (same shape as the AbelDent connector), and access requires enrollment in the Dentrix Developer Program / Henry Schein One API Exchange. | **Needs vendor confirmation** — gated by a commercial developer relationship CollectRx does not currently hold |
| Eaglesoft (Patterson) | A "local API" exists for authorized third parties; Patterson explicitly warns that unauthorized database-level integration risks breaking on schema changes. | **Needs vendor confirmation** — requires becoming an authorized Patterson Innovation Connection vendor |
| Curve Dental | Vendor markets an API but there is no public documentation, self-serve keys, or sandbox — access is a sales-mediated partner program. | **Unsupported today** — no path to build against without a formal partnership |
| Softdent (Carestream) | No open public API program; integration only through Carestream's formal Authorized Partner program. | **Unsupported today** |
| Other (generic CSV) | No vendor by definition. | **N/A** |

**What this rules out**: no vendor among the six documents a built-in scheduled/automatic
export feature (Option 1's PMS-side half). A CollectRx-initiated API pull (Option 2) is
realistic only for Open Dental today; AbelDent already has the live-DB equivalent shipped.
UI automation (Option 3) was not attempted — it cannot be tested reliably without a live
install of each PMS.

## What was built

Given the evidence, the only piece buildable now without assuming an unconfirmed vendor
capability is the **CollectRx-side half of Option 1**: a local folder-watcher that
removes the recurring manual **upload** step, regardless of how a file lands in the
watched folder (staff export, a practice's own scheduled task, or a PMS feature if one
exists). It does not claim to automate the **export** step for any vendor.

- `Collect-RX-main/desktop/services/folderWatchSync.cjs` — polling watcher: file-stability
  check (avoids reading mid-write), SHA-256 content-hash dedupe ledger, exponential
  backoff retry capped at a configurable attempt limit (then flags `needs_attention`
  instead of retrying forever), configurable retention policy (`move` default /
  `delete` / `keep`), PHI-minimized local logging (redacts email/date/phone-shaped
  strings, never logs row contents).
- `POST /api/connector/claims/import-file` (`connectorRoutes.ts`) — new
  connector-token-authenticated upload endpoint reusing the existing, tested
  `parseSimpleCsv` → `runPmsImportPipeline` path. All parsing/normalization/upsert/
  validation logic is unchanged and shared with the session-authenticated manual upload
  route (`pmsSyncRoutes.ts`), which remains untouched as the fallback.
- `electron-shell/main.js` — spawns the watcher only when `WATCH_FOLDER` is configured;
  independent of the AbelDent SQL connector (a practice can run either, both, or
  neither).
- `PmsIngestMode` gained `'folder_watch'` (JSON settings field, no migration needed).

## Known gap this did not close

Building an Open Dental API-pull connector (the strongest Option-2 candidate per the
evidence above) was out of scope for this change — there is no live Open Dental instance
to test against, and CLAUDE.md's standing rule is not to ship untested paths. Flagged as
recommended future work, not implemented.
