# Paste-ready prompt — Compliance code handoff verification & closeout (copy everything below the line)

---

Work in this repo's `Collect-RX-main/` workspace. First read `docs/compliance/CODE-HANDOFF-COMPLIANCE.md` in full.

**Critical context before you start:** that doc was written 2026-06-15 against an older architecture (`src/types/practice.ts`, `src/api/services/vapiService.ts`, an in-memory `src/api/db.ts` with `Map`s) that predates the current Prisma/Postgres backend. Those exact file paths no longer exist. Verifying this task against the current codebase directly (grep + read, done already once — trust it but re-verify yourself, don't just take this prompt's word for it) shows **most of the required work already shipped**, just under different file names and, in one case, a different (and more correct) mechanism than the doc specified:

- **Change 1** (CarrierConfig fields): `providerNumber`, `authorizationSubmitted`, `authorizationSubmittedAt` already exist on the current carrier-config type in `Collect-RX-main/src/types/practiceSettings.ts` and are wired through `src/carriers/adapter.ts` and `src/server/services/practiceSettingsService.ts`.
- **Change 2** (Vapi payload injection): `practiceName` and `providerNumber` are already injected into calls — via `assistantOverrides.variableValues` in `Collect-RX-main/src/vapi/client.ts`, not the `metadata` field the doc describes. Read the comment at the injection site: Vapi's `CreateCallDTO` silently drops top-level `metadata`/`variables`, so `variableValues` under `assistantOverrides` is the mechanism that actually works. Don't "fix" this back to `metadata` — the current code is right and the doc is stale.
- **Change 3** (PHI audit logging): exists as `Collect-RX-main/src/server/crypto/phiCryptoAudit.ts` (`logPhiCryptoAccess`) plus `src/server/audit/auditLog.ts` — different shape than the doc's `phiAuditService.log()` sketch, but covers the same requirement (structured log of PHI encrypt/decrypt operations, no plaintext, timestamped, actor-tagged).
- **Change 4** (Practice Settings UI): `Collect-RX-main/src/pages/PracticeSettings.tsx` already has the provider-number input and authorization-submitted toggle.

**Correction (2026-07-28):** this doc originally said the "optional enforcement" was not done. That was wrong — a closer read of `src/carriers/adapter.ts` found it already fully implemented as `checkCarrierAuthorizationGate()`, called from `validateDispatch()` (which `queueEngine.ts` calls before every dispatch). It hard-blocks with code `CARRIER_NOT_AUTHORIZED` — explicitly named "Billing Agent Authorization Letter (BAAL) not on file" in the rejection reason — when `authorizationSubmitted` is false, and the rejection is surfaced visibly: `queueEngine.ts`'s `deferQueueEntry()` writes `dispatchDeferralCode`/`dispatchDeferralNextAction` onto the queue entry, and `src/pages/LiveConsole.tsx` renders it. So the hard-block, with a non-silent UI state, was already shipped — nothing to implement here. Re-verify this yourself (don't just trust this note) and, if confirmed, tick it off rather than re-doing it.

## Hard rules (stop conditions)
- Do NOT re-implement Changes 1–4, and do NOT re-implement the `authorizationSubmitted` gate described above — it already exists. If your own verification finds a real gap in any of them, report it precisely (file, line, what's missing) — don't rewrite the whole thing to be safe.
- Do NOT modify `src/vapi/client.ts`'s payload construction without re-running the PHI-boundary check in step 3 immediately after, and reverting if it fails.
- Do NOT touch CARRIER_BLOCK logic.

## Task — verify each acceptance criterion against current code
Go through `docs/compliance/CODE-HANDOFF-COMPLIANCE.md`'s "Acceptance Criteria" checklist one item at a time. For each, cite the actual current file/line as evidence (not the doc's stale paths) rather than assuming the summary above is exhaustive:

1. `CarrierConfig` has `providerNumber`, `authorizationSubmitted`, `authorizationSubmittedAt` — confirm in `src/types/practiceSettings.ts`.
2. `vapiService.startCall()` (or its current equivalent) sends `practiceName` and `providerNumber` to Vapi — confirm the exact call site in `src/vapi/client.ts`, and confirm by tracing one real call path (e.g. `queueEngine.ts` → `client.ts`) that these values are actually populated from the practice record at dispatch time, not left as empty-string defaults in production.
3. The queue/dispatch logic passes practice name and provider number when starting a call — same trace as above.
4. **PHI audit log fires at every detokenization point** — this is the one requiring the most scrutiny. Grep for every place a claim/patient UUID token is mapped back to a real patient identifier (post-call completion, staff viewing claim detail, any export) and confirm each site calls `logPhiCryptoAccess` (or equivalent). It's easy for a newer code path to have been added without the corresponding audit-log call — that's the realistic failure mode here, not "the mechanism doesn't exist at all."
5. Carrier config table in `PracticeSettings.tsx` shows the provider-number input and authorization toggle — confirm visually in the component code (or run the app and check the rendered UI if you have a way to do so).
6. Settings validation schema covers the new `CarrierConfig` fields — find the current validation middleware (search for where `updateSettings`-equivalent schemas live now) and confirm `providerNumber`/`authorizationSubmitted`/`authorizationSubmittedAt` are validated, not just passed through.
7. **No patient name, DOB, or health card number appears in any Vapi API request payload** — re-verify this explicitly yourself by reading the full payload construction in `src/vapi/client.ts` for both call-starting functions, rather than trusting the earlier pass. This is the hard PHI-boundary line from `CLAUDE.md`; get it right.

## Output
1. Update `docs/compliance/CODE-HANDOFF-COMPLIANCE.md`: tick each verified checkbox, and add a dated note near the top: "Verified against current codebase (`Collect-RX-main/`) on `<date>` — the file paths and `db`/`vapiService` structure described in this doc reflect the pre-Prisma architecture and are historical; see the verification note for current locations. The 'optional enforcement' item is implemented (`checkCarrierAuthorizationGate` in `carriers/adapter.ts`, hard-block)." Do not delete the original doc content — it's still useful history of what was required and why.
2. If you find a genuine gap in items 1–7 (not just a stale path, an actual missing behavior), report it clearly instead of silently fixing it — these are compliance-sensitive and should get a second set of eyes before merging.

## Final report format
Seven-item checklist (pass/fail/gap-found, one line each with the file:line citation). Nothing else.
