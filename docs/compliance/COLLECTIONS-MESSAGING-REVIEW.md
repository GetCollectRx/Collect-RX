# Collections messaging — content review (P5-08)

**Purpose:** satisfy “message templates reviewed for timing, frequency, disclosure” in Phase 5.

| Channel | Code location | Items to verify with counsel |
|--------|---------------|----------------------------------|
| Email (balance) | [messaging.ts](../../Collect-RX-main/src/server/patients/messaging.ts) `sendEmail` | Text, frequency of reminder series, `List-Unsubscribe` / footers, contact line |
| SMS | same file `sendSMS` | “Reply STOP”, rates disclaimer, time-of-day and volume rules in your state/province |
| Voice / Vapi | IVR and eligibility | Transcript retention, disclosure at start of call, recording consent if any |

| Review date | Reviewer | Jurisdiction / notes |
|-------------|----------|----------------------|
| | | |

**Do not** store full legal memos in this repo; link or attach in your DMS.
