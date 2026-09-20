// ─────────────────────────────────────────────────────────────────────────────
// CollectRx AR Engine — module overview
//
// Five pieces, each independently unit-testable, that together take a claim
// from "queued" to "resolved and reconciled" while respecting the PHIPA/
// PIPEDA boundary that governs everything in this codebase (see
// `docs/compliance/PHI-VAPI-BOUNDARY.md` and CLAUDE.md "Critical safety
// rules"). None of these modules replace existing production code — where a
// canonical implementation already exists (the PHI vault, outcome
// classification, carrier-block detection), these modules delegate to it
// rather than forking a second copy. See each file's header for the specific
// division of labour.
//
// How a call moves through the five pieces:
//
//   1. tokenizer.ts     A claim's PHI (patient name, DOB, health card number)
//                        is tokenized to a UUID before it ever reaches this
//                        engine — never plaintext PHI in a claim record.
//
//   2. stateMachine.ts   `CallLifecycleMachine` drives the attempt through
//                        Claim_Queued -> Dialing -> IVR_Navigation ->
//                        Queue_Hold -> Agent_Connected ->
//                        Adjudication_Extracting -> Sync_Pending -> Success
//                        (or Failed, with a durable Failed -> Claim_Queued
//                        retry edge). Every transition into a dial-capable
//                        state is gated on CARRIER_BLOCK — see file header.
//
//   3. telephonyParser.ts Once Agent_Connected, the live transcript is
//                        cleaned of hold-music noise and mined for claim
//                        numbers, member/client IDs, and dollar amounts.
//                        This is metadata extraction, not PHI — no patient
//                        identifiers are expected to appear in what this
//                        module reads or returns.
//
//   4. schemas.ts        During Adjudication_Extracting, the parser's output
//                        plus the outcome classification (from
//                        `src/outcome/processor.ts`) are normalized into the
//                        locked `CarrierAdjudicationPayload` shape — keyed
//                        by the tokenizer's UUID (`claim_id_token`), never a
//                        raw patient or claim identifier — and validated
//                        before Sync_Pending allows any write-back to the
//                        practice's ledger (e.g. the AbelDent connector).
//
//   5. reconciler.ts     Independently of any single call, compares the
//                        practice's aging report against the population of
//                        resolved claims to report call success rate,
//                        average hold time, and total dollars recovered —
//                        the ROI evidence this whole engine exists to
//                        produce.
//
// PHI never appears in stateMachine.ts, telephonyParser.ts, schemas.ts, or
// reconciler.ts — all four operate on UUID tokens, claim metadata, and
// dollar figures only. tokenizer.ts is the sole boundary where PHI is
// handled, and even there it delegates the actual encryption to the
// existing `src/pii-vault.ts` vault rather than introducing a second one.
// ─────────────────────────────────────────────────────────────────────────────

export * from './tokenizer.js';
export * from './stateMachine.js';
export * from './telephonyParser.js';
export * from './schemas.js';
export * from './reconciler.js';
