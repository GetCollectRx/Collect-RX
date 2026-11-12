# Office day simulation report (2026-11-10)

Point-in-time record. Suite: [`Collect-RX-main/tests/sim-harness/officeDay.e2e.test.ts`](../../Collect-RX-main/tests/sim-harness/README.md). Offline, no keys, no calls, $0. Two consecutive runs gave identical results: PASS 51, FAIL 0, UNVERIFIED 2, FINDING 13.

## Limits of this report

- No audio, no Vapi, no carrier. Pickup timing, hold detection, what the live prompts say and the UI are not covered.
- A FAIL means a documented rule was broken. None did. A FINDING is behaviour a pilot practice would hit that no document calls intended; several are design choices the owner may accept.
- Native Vapi message shapes come from the code, as in Stage 1.
- Two checks are UNVERIFIED: re-evaluation of young claims as they age (needs time travel across days) and cross-practice carrier blocks beyond the single case in finding 7.

## Findings, ranked for a pilot practice

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | P1 | One bad row discards the whole import. A trailing blank row, a negative balance (credit or refund), an unsupported carrier, a blank carrier, a missing claim number or a PMS footer total row each leave the office with an error and zero claims. A zero balance, currency formatting, a day-first date and missing treatment codes are handled. | Run checks 4, 5, 8 to 11: good rows stored 0 of 5 with one bad row. The negative case fails because the formula guard prefixes an apostrophe to values starting with a minus sign. |
| 2 | P1 | No holiday calendar in the call window. A call is placed on Christmas Day. | Check 29. |
| 3 | P1 | The call window is Eastern only. A Vancouver office is dialled at 05:00 local, before staff can answer a Hold Sentinel transfer. | Check 31. Related to Stage 1 finding 7. |
| 4 | P2 | Blocked claims show no reason in the queue row. Carrier block sets status BLOCKED but leaves the deferral code empty. | Check 44. Any banner elsewhere in the UI is not covered. |
| 5 | P2 | A practice with the voice agent disabled has queue rows with no reason. Other gates (carrier authorization) do record a code. | Check 61. |
| 6 | P2, commercial | A call that reports zero seconds and never connected is billed one minute. | Checks 33, 36. |
| 7 | P2, design question | A carrier block raised by one practice does not stop another practice calling that carrier. The rule text reads fleet-wide; the record is per practice or organization. | Check 50. |

## What passed

Carrier spellings (15 variants of the six carriers), awkward names, BOM and CRLF files, age gates at 29, 30, 90 and 91 days (claims over 90 days are not dialled and appear on the staff work list), call window edges (07:59, 08:00, 16:59, 17:00, weekends), failed and no-answer calls closing cleanly with a 24 hour recall, the escalation ladder, per-carrier block and recovery, tenant isolation on the desk API (403 on both takeover and listing), signature checks, duplicate and out-of-order webhooks without double billing, re-import after resolution, authorization gate with a recorded reason, TELUS claims never sent to the placeholder number, zero plaintext PHI in any table after the day, no PHI in outbound requests outside call variables, clean teardown.

## Harness notes

- The queue tick works every practice, so the suite parks other practices' rows before each tick.
- The in-process concurrency case was dropped: production ticks are serialized by `isTickRunning` and a database lease, so direct concurrent calls are not a production path.
- The fleet-wide limit of five active calls per carrier (`CARRIER_CONCURRENCY_LIMITS`) will bind a pilot that shares a carrier with other practices; not a defect, but plan for it.
