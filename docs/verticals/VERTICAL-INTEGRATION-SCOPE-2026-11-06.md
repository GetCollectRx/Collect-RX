# Non-dental verticals: integration scope (2026-11-06)

Point-in-time record. Branch `feature/verticals-industry-ar-worklist`, base `69644ee`. Covers the six non-dental verticals in `IndustryType`: AUTO_COLLISION, PROPERTY_RESTORATION, PARAMEDICAL_PHYSIO, DME, ROOFING_TRADES, NEMT.

## Limits of this document (read first)

- **No market or payer research was done.** Nothing here states which insurers serve which vertical, their claim lines, their IVR trees, their follow-up norms, or regulatory deadlines (for example WSIB, WCB, provincial auto schemes, ADP). Every such fact must come from a verified source before it enters code.
- **Findings are from reading the code on `69644ee`**, plus the tests in this branch. The frontend was searched by text, not run.
- **Product decisions are not made here.** Items marked `[DECISION]` are Khalid's call.

## What exists today

| Piece | State | Evidence |
|---|---|---|
| Data model | `IndustryType` on `InsuranceClaim`, free-text `payerName`, typed primary and secondary references (VIN, policy, patient id, MRN as vault tokens), `lineItems` JSON | `prisma/schema.prisma` (`enum IndustryType`, `InsuranceClaim.industryType`); `src/types/industry-claims.ts` |
| Ingest | `POST /api/insurance/claims/upload`, one CSV per vertical, header aliases per vendor export, required date format, PHI tokenized, one transaction | `src/routes/insurance.ts` (`/claims/upload`); `src/server/csv/industryClaimImport.ts`; `src/config/csv-aliases.ts` |
| Calling | Blocked by design: claims are stored as `carrierId 'other'`, the queue engine skips them, the Vapi client refuses them | `src/server/frontDesk/queueEngine.ts:671`; `src/vapi/client.ts:216` |
| Voice prompts | `INDUSTRY_PROMPTS` and `buildVoicePrompt` exist and are tested, but nothing outside their test imports them | `src/config/prompts.ts:212`, `:276` |
| UI | **None.** No page references `industryType`, an industry value or the upload route | text search of `src/**/*.tsx` |

## Findings

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| V1 | High | **Imported non-dental claims were write-only.** Nothing read them back: no route, report or page. | No reader of `industryType` outside the importer before this branch | **Fixed in this branch** (summary and worklist routes) |
| V2 | High | **A paid claim never left the books.** Re-uploading an export where a claim's balance is now zero skipped the row, so the stored claim kept its old balance. | `industryClaimImport.ts`, the zero-balance branch | **Fixed in this branch**: existing claims are set to a zero balance, with no token minted; new zero-balance rows are still skipped |
| V3 | Medium | **A claim missing from a later export stays open.** The importer cannot tell a full snapshot from a partial export. | `industryClaimImport.ts` only touches claim numbers present in the file | `[DECISION]` see D2 |
| V4 | Medium | **Every re-upload resets status to PENDING** and overwrites the balance, losing any status set since. | `industryClaimImport.ts`, `status: 'PENDING'` inside the upsert `update` | Open, fix with D3 |
| V5 | Medium | **Every re-upload mints new vault tokens** for the same person and references; the previous tokens are not expired. | `industryClaimImport.ts`, `mint()` per row, upsert overwrites token columns | Open; vault growth and orphaned PHI. Needs a token reuse or expiry step |
| V6 | Medium | **Stored age is frozen at import.** `daysOutstanding` and `priority` never change after upload, because non-dental claims are not re-synced. | `industryClaimImport.ts` (`daysOutstanding`, `priority`) | Worked around in the new view (age from date of service at read time). Stored columns still stale |
| V7 | Low | **Non-dental claims appear in the dental claims list** (`GET /api/insurance/claims`), which has no industry filter. | `src/routes/insurance.ts`, the `/claims` handler `where` | Open. UI rendering of `carrierId 'other'` not checked (UNVERIFIED) |
| V8 | Low | **One payer arrives under many spellings** ("SYNTHETIC MUTUAL INS.", "Synthetic Mutual Insurance Inc."), so per-payer totals were not possible. | free-text `payerName` | **Fixed in this branch** by a conservative normalizer |
| V9 | Info | **CARRIER_BLOCK is keyed by `CarrierId`**, so a non-dental payer cannot be blocked individually. Harmless today because nothing dials; a hard prerequisite before any non-dental dialling. | `prisma/schema.prisma` `CarrierBlockEvent.carrierId CarrierId` | Prerequisite for Phase 4 |

## Built in this branch

| Change | Files |
|---|---|
| Payer normalizer: strips accents, punctuation, a leading "the", trailing legal suffixes and the generic word "insurance"; keeps words that can separate two payers (life, general, mutual); never empties a name | `Collect-RX-main/src/server/verticals/payerNormalization.ts` |
| AR read model: open, non-deleted, non-dental claims with a balance; live age; aging buckets 0-29 to 120+; totals by industry and by payer; prioritised worklist using the dental queue's age and amount scores; `dialable: false` with reason `NO_VERIFIED_PAYER_LINE` on every row | `Collect-RX-main/src/server/verticals/industryAr.ts` |
| `GET /api/insurance/claims/industry/summary` and `GET /api/insurance/claims/industry/worklist?industryType=&payerKey=&limit=` | `Collect-RX-main/src/routes/insurance.ts` |
| Zero-balance re-upload clears the stored balance (V2); the upload response and audit entry report `zeroedExisting` | `Collect-RX-main/src/server/csv/industryClaimImport.ts` |
| Tests: 51 unit cases; 7 integration cases through the real upload route, real vault and real Postgres | `src/server/verticals/*.test.ts`, `src/server/csv/industryClaimImport.test.ts`, `tests/industryArRoutes.integration.test.ts` |

**Safety properties, each covered by a test:** session practice only, with a forged `practiceId` refused (403); no insured name, VIN, policy number, reference value or vault token in either response (a deliberate leak was injected and the test failed, then reverted); nothing is dialable; nothing is queued; no external call.

**Not done in this branch:** no UI, no schema change, no migration, no change to dialling, queueing, Vapi or CARRIER_BLOCK.

## Roadmap

Each phase is independently shippable and leaves calling blocked until Phase 4.

| Phase | Scope | Needs from Khalid | Blocks |
|---|---|---|---|
| 1. Make it visible | Industry AR page: upload form (vertical, date format, file), summary by payer and aging, worklist with filters. Uses only the routes above | `[DECISION]` D1 placement | Nothing |
| 2. Make it correct | Fix V3 (snapshot vs delta, D2), V4 (keep status on re-upload, D3), V5 (reuse or expire tokens), V6 (nightly re-age or drop the stored columns), V7 (filter dental list, D4) | D2, D3, D4 | Phase 1 for user value |
| 3. Payer registry | `Payer` table (normalized key, display name, verticals) and a per-practice alias map from free-text spellings to a payer. Contact channels stored with `verifiedBy`, `verifiedAt` and `source`, human-entered only, never scraped or guessed. Schema change, RLS policy and migration | D5 who verifies payer data | Phase 4 |
| 4. Make it callable | Generalise the dial allowlist from `CarrierId` to a verified payer channel; CARRIER_BLOCK keyed by payer (V9); wire `buildVoicePrompt` per vertical; CRTC disclosure unchanged; PHI boundary review for each vertical (paramedical is health information; auto and property are personal information) | D6 first vertical, D7 compliance sign-off | Phase 3, plus the Stage 2 simulation harness against a mock payer |
| 5. Vertical workflows | Per-vertical follow-up cadence, escalation and outcome semantics (for example supplements in auto collision, scope disputes in restoration, funder programmes in DME) | Domain input per vertical; nothing invented | Phase 4 |

## Decisions for Khalid

| ID | Question | Options |
|---|---|---|
| D1 | Where does the industry AR view live? | (a) new page; (b) a tab on Insurance Claims; (c) inside AR Command Center |
| D2 | Is each upload a full snapshot of open AR? | (a) yes: claims missing from the file close automatically; (b) no: closing needs an explicit zero row (today's behaviour after V2); (c) per upload toggle |
| D3 | On re-upload, may the file change a claim's status? | (a) never, keep the current status and update balance only; (b) only from PENDING |
| D4 | Should non-dental claims show in the dental claims list? | (a) hide them; (b) show with an industry column |
| D5 | Who verifies payer contact data before it can be dialled? | Named role, and the evidence required |
| D6 | First vertical to make callable | Any of the six; should follow paying-customer demand |
| D7 | Compliance owner for non-dental PHI and PI | Needed before Phase 4 |

## UNVERIFIED

- Whether the frontend renders `carrierId 'other'` claims correctly in the dental list (V7).
- Real vendor export headers for each vertical. Aliases in `csv-aliases.ts` predate this branch and were not checked against real exports here.
- Any statement about a payer, a vertical's norms or a regulator. None is made.
