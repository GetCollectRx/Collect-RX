# phi-guard

Standalone tooling that keeps personal health information (PHI) out of large language model prompts, logs, and storage for CollectRx. It has no connection to the main application and is deliberately not part of the root npm workspaces.

All identifiers are treated as PHI under Ontario's PHIPA, including claim numbers and dates. Where behaviour is ambiguous, the stricter choice is used.

| Module | Directory | Purpose | Runtime dependencies |
|---|---|---|---|
| A. phi-redact | `src/redact` | Replaces identifiers in transcript text with tokens | none |
| C. synthetic-data | `src/synthetic` | Generates fake patients and claims for testing | none |
| B. retention-check | `src/retention` | Verifies no call content remains at Vapi and artifacts reached Azure Blob | `@azure/storage-blob`, `@azure/identity` |

## Setup and scripts

Requires Node 20 or later. Run `npm ci` in this directory.

| Script | What it does |
|---|---|
| `npm run build` | Compiles `src` to `dist` |
| `npm run typecheck` | `tsc --noEmit` with `strict` on |
| `npm run lint` | ESLint with typescript-eslint `recommendedTypeChecked`, zero warnings allowed |
| `npm test` | Vitest |
| `npm run coverage` | Vitest with a 95 percent line threshold per module directory |

All dependencies are pinned to exact versions. The code contains no `any`.

## Node target and accepted risk

The repository's Node floor is 20: `engines` in `Collect-RX-main/package.json` is `>=20.10.0`, and every GitHub Actions job pins Node 20. Only the Fly runtime images use Node 22. This package therefore stays on Vitest 3.2.7, which supports Node 20.

`npm audit` reports 4 findings (2 moderate, 2 critical) in `tinypool` and `@vitest/mocker`, both reached only through Vitest. The fix is Vitest 5, which requires Node 22.12 or later. These are development-only: they concern worker options and mock registration while running tests, and nothing here ships or runs against untrusted test code. This risk is accepted until the repository moves its Node floor to 22.12 or later, at which point upgrade Vitest to 5.x.

## Module A: phi-redact

```ts
import { redact } from "./src/redact/index.js";

const { redacted, findings } = redact(transcript, {
  patientFirstName: "Alma",
  patientLastName: "Quillfeather",
  dateOfBirth: "1985-03-04",
  memberId: "SYN-48271936",
  claimNumber: "SYN-CLM-905173",
});
```

`redact(text, context)` is a pure function. It performs no I/O, keeps no state between calls, and never logs.

### Token format

Tokens look like `[[TYPE_N]]`, for example `[[MEMBER_ID_1]]`. `N` counts from 1 per type within one call, in order of first appearance. The same value always receives the same token within a call.

`findings` holds one `{ token, type }` entry per distinct token. It never contains the original value, its length, or its position.

Types: `PATIENT_NAME`, `DOB`, `DATE`, `MEMBER_ID`, `CLAIM_NUMBER`, `HEALTH_NUMBER`, `PHONE`, `EMAIL`, `DIGIT_SEQUENCE`.

All written and spoken forms of the patient's name share one `PATIENT_NAME` token, and all forms of the date of birth share one `DOB` token.

### DOB versus DATE

Any full calendar date that includes a year is redacted.

- If it matches `dateOfBirth` in any form, it becomes `DOB`.
- Otherwise it becomes `DATE`. A service date is therefore always `DATE`.

Numeric dates such as `03/04/1985` can be read month first or day first. They become `DOB` if either reading matches the date of birth. With no match they become `DATE`, and the two readings stay distinct from each other. Over-redaction of ambiguous dates is intentional.

Date of birth forms recognised: ISO and slashed numerals, both day and month orders, written dates with ordinals, spoken dates ("march fourth nineteen eighty five"), compact digits (`19850304`), and spoken numeric forms ("oh three oh four nineteen eighty five", "zero three zero four one nine eight five", "three four eighty five", with day-first and year-first variants).

### What is redacted

1. Layer 1, known values from `CallContext`: names (first, last, full in either order, spelled out letter by letter), date of birth, member ID, and claim number. Identifiers match as written, spoken digit by digit with spaces or hyphens, spoken as digit words, with "oh" for zero, and with "double" before a repeated digit.
2. Layer 2, patterns: runs of six or more digits (numerals or spoken digit words), Ontario health numbers, North American phone numbers, email addresses, and full calendar dates.

Matches that overlap are merged into one region, so no fragment of an identifier is left behind.

### What is not redacted

IVR phrases ("press 1", "option 2", "press star"), times ("3 pm", "10:30"), currency amounts, business hours, and durations ("21 days"). Each has a test.

### Failing closed

Non-string input, input over 100,000 characters, and an invalid context throw an error with a fixed message that never contains input content and carries no cause. A throwing context getter is handled the same way. No error path returns unredacted text.

The context is validated strictly: unknown keys are rejected, names need at least 2 letters, IDs need at least 4 letters or digits, and empty strings are rejected rather than treated as absent.

### Known limitations of the redactor

- Spoken names cannot be matched without a `CallContext`. A name that is not in the context is not redacted, including a subscriber's or provider's name.
- Spoken names are matched as the context spells them. Phonetic variants and mis-transcriptions ("Kwill feather") are not matched.
- Spoken emails ("foo at example dot test") are not recognised.
- Numbers spoken in pairs or as words other than digits ("twelve thirty four fifty six") are not treated as digit sequences.
- A spoken numeric date that is not the date of birth and has no month name ("oh three oh five nineteen eighty five") is not recognised as a `DATE`.
- Ambiguous dates are over-redacted by design, and a bare year or a month and day without a year are left alone.
- A malformed date such as `31/31/2024` is redacted as a digit sequence, not as a date.
- Plain ten-digit numbers are labelled `HEALTH_NUMBER` even when they are phone numbers. Both are redacted.
- Common words used as names ("Page", "May") are redacted wherever they appear.
- Text is normalised before matching (NFKC, with zero-width and soft-hyphen characters removed), so the redacted output is also normalised.
- A transcript that already contains token-shaped text such as `[[PHONE_1]]` is passed through unchanged and can be confused with a real token.
- Matching relies on the context being correct. A wrong `CallContext` weakens layer 1, though layer 2 still applies.
