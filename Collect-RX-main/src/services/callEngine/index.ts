// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Call Engine
//
// Five modules that together track a claim's call lifecycle from queue to
// ledger write-back, under the same PHI and CARRIER_BLOCK rules as the rest
// of the app (see CLAUDE.md "Critical safety rules" and
// docs/compliance/PHI-VAPI-BOUNDARY.md):
//
//   tokenizer.ts        — facade over the canonical PHI vault (src/pii-vault.ts)
//   stateMachine.ts      — durable, idempotent call-lifecycle state machine
//   telephonyParser.ts   — structural extraction from raw call transcripts
//   schemas.ts            — polymorphic per-carrier adjudication validation
//   reconciler.ts         — aging-report vs. call-outcome ROI telemetry
//
// None of these introduce a second PHI store, a second webhook dedupe table,
// or a second outcome classifier — each wraps or complements the existing
// production implementation it's adjacent to (see the header comment in each
// file for specifics). Import from the individual files; this barrel exists
// for discoverability only.
// ─────────────────────────────────────────────────────────────────────────────

export * from './tokenizer';
export * from './stateMachine';
export * from './telephonyParser';
export * from './schemas';
export * from './reconciler';
