# phi-guard

Standalone tooling that keeps personal health information (PHI) out of large language model prompts, logs, and storage for CollectRx. It has no connection to the main application and is deliberately not part of the root npm workspaces.

All identifiers are treated as PHI under Ontario's PHIPA, including claim numbers and dates. Where behaviour is ambiguous, the stricter choice is used.

| Module | Directory | Purpose | Runtime dependencies |
|---|---|---|---|
| A. phi-redact | `src/redact` | Replaces identifiers in transcript text with tokens | none |
| C. synthetic-data | `src/synthetic` | Generates fake patients and claims for testing | none |
| B. retention-check | `src/retention` | Verifies no call content remains at Vapi and artifacts reached Azure Blob | `@azure/storage-blob` 12.32.0, `@azure/identity` 4.13.0 |

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

## Module C: synthetic-data

Generates fake patients and claims in the CollectRx CSV import format, plus one `CallContext` JSON file per claim for module A tests. It has no runtime dependencies and no network access.

```sh
npm run build
node dist/synthetic/bin.js generate --count 25 --seed my-seed --out ./out
```

This writes `claims.csv` and `context-<claimNumber>.json` for each row. `--count` is 1 to 10000. `--seed` is 1 to 64 characters from letters, digits, `.`, `_` and `-`. The same seed and count always produce byte-identical files. The generator is a seeded sfc32 and never calls `Math.random`. Bad arguments exit with code 2 and print the usage line.

### Which import path this targets

The live endpoint is `POST /admin/sync/import`. It runs `parseSimpleCsv`, then `runPmsImportPipeline`, which calls `normalizePmsClaimRow` with the generic import family (the `other` vendor). That path matches headers by alias and has no fixed column order, so this tool emits one set of snake_case keys that `parseSimpleCsv` leaves untouched and `normalizePmsClaimRow` reads. Every generated row was checked against the full pipeline source, not only the normaliser. The columns, in order:

| Column | Why it is present |
|---|---|
| `claim_number` | Required. A row without a claim id fails the whole file. Unique per row, so no line merging or carrier conflict. |
| `patient_first_name`, `patient_last_name` | Tokenised into the PHI vault; the carrier lookup needs them. |
| `patient_dob` | Vault; the carrier asks for it. ISO `YYYY-MM-DD`, the form the normaliser re-emits. |
| `subscriber_id` | Vault; the member id. Starts with `SYN-`. |
| `group_policy_number` | Vault; the group number. Starts with `SYN-GRP-`. |
| `insurance_carrier` | Required. A blank or unrecognised carrier fails the whole file in the preflight, before anything is written. |
| `procedure_code` | First CDT code on the claim. |
| `treatment_codes` | An empty value makes the submission quality gate raise a blocking action, which keeps the claim out of the call queue. Two codes are written as a quoted, comma separated cell, as real exports do. |
| `treatment_date` | Date of service. Empty raises a non-blocking gate. |
| `submitted_date` | Submission date. Empty raises a non-blocking gate. |
| `amount_billed` | Plain decimal, two places, no `$` or thousands separators. |
| `amount_outstanding` | Must be above zero. A zero or blank balance is skipped as already paid. |
| `expected_amount` | Above zero, or the gate notes that underpayment detection is off. |
| `days_outstanding` | 32 to 88. The call queue takes 30 to 90, and `validateDispatch` applies a flat 30 day floor. When this column is present it overrides any age computed from the service date. |

Columns left out on purpose, because each one changes pipeline behaviour: `paid_amount` (triggers underpayment checks), `denial_code` and `transaction_type` (create a blocking denial review and keep the claim out of the queue), `treating_dentist_provider_number` (is looked up in the database and fails the row if unknown), and the subscriber, relationship and dependent columns.

### Synthetic data conventions

- Member ids start with `SYN-`, claim numbers with `SYN-CLM-`, group numbers with `SYN-GRP-`.
- Names come from a fixed list of 20 obviously fictional names in `src/synthetic/names.ts`.
- Dates of birth fall between 1900-01-01 and 1929-12-31 inclusive. That range is outside any living person's, so a generated value cannot be mistaken for a real one.
- Service dates count back from the fixed anchor date 2026-06-30, so output never depends on the clock. Because the anchor is fixed, `days_outstanding` is an explicit column rather than a computed one.
- Carriers are only Sun Life, Canada Life, Manulife, Green Shield, RBC, and TELUS AdjudiCare, spelled as the carrier map accepts them.
- No value starts with `=`, `+`, `-`, `@` or `%`, which `parseSimpleCsv` would rewrite.

### What the tests run against the repository

`test/synthetic/repo-pipeline.test.ts` loads the repository's own `parseSimpleCsv`, `normalizePmsClaimRow`, `mapToCarrierId`, `mergeClaimRows` and `validateImportTotals` and runs 120 generated rows through them. It asserts the conditions the later stages test: positive balance, age 30 to 90, treatment codes, service and submission dates, an expected amount, and no denial or dentist columns. The repository's CSV validator imports `zod`, which a bare checkout does not install, so the test resolves `zod` from this package's pinned dev dependency. The test skips itself if the repository directory is not next to this package.

Not run: the database stages (claim upsert, PHI vault, submission quality gate, work item sync, call queue sync). They need Prisma and a live database, so end-to-end import of these files is unverified.

## Module B: retention-check

After a synthetic test call, confirms that Vapi holds no call content and that our Azure Blob container received the artifacts. It never places a call, changes Vapi configuration, or creates or modifies Azure resources.

```sh
npm run build
export VAPI_API_KEY=...            # a private Vapi API key
export AZURE_STORAGE_ACCOUNT=...   # storage account name, not a URL
node dist/retention/bin.js --call-id <id> --container <name> --prefix <blobPrefix>
```

Configuration comes from those two environment variables only. Azure authentication is `DefaultAzureCredential`. Connection strings and account keys are not supported, and are ignored if set.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Vapi holds no content and at least one blob exists in our container |
| 1 | Any check failed: content present, call not ended, Vapi or Azure error, or no blob found |
| 2 | Bad argument or missing or malformed configuration. Nothing was requested. |

A Vapi HTTP error, including 404, exits 1. A missing call is not proof that nothing was retained, so the tool fails closed.

### The Vapi check

It calls `GET https://api.vapi.ai/call/{id}` with a bearer token (official reference: docs.vapi.ai/api-reference/calls/get). It passes only if the call has `status` of `ended` and every content field below is absent, null, an empty string, or an empty container (checked recursively). A call that has not ended fails, because content is attached after it ends and earlier absence proves nothing.

Content fields, all response field names from the reference:

| Group | Fields |
|---|---|
| Messages | `messages`, `artifact.messages`, `artifact.messagesOpenAIFormatted` |
| Transcript | `artifact.transcript` |
| Recordings and packet capture | `artifact.recording`, `artifact.recordingUrl`, `artifact.stereoRecordingUrl`, `artifact.videoRecordingUrl`, `artifact.pcapUrl`, and `artifact.presignedMonoUrl`, `presignedStereoUrl`, `presignedVideoUrl`, `presignedAssistantUrl`, `presignedCustomerUrl`, `presignedPcapUrl` |
| Logs | `artifact.logUrl`, `artifact.presignedLogUrl` |
| Structured outputs and derived values | `artifact.structuredOutputs`, `artifact.skippedStructuredOutputs`, `artifact.scorecards`, `artifact.variableValues`, `artifact.nodes`, `artifact.transfers` |
| Post-call analysis | `analysis.summary`, `analysis.structuredData`, `analysis.structuredDataMulti`, `analysis.successEvaluation` |

Each field is reported as `PRESENT` or `absent`. Values and response bodies are never printed, logged, or put in an error message.

The call id must be a UUID. Vapi's reference types the id only as a string. The one place its docs name a format is the Langfuse `traceName` text, where `{{ call.id }}` is "Call UUID". If Vapi ever issues ids in another shape, relax the pattern in `src/retention/validate.ts`.

### The Azure check

It lists blobs under `--prefix` whose name contains the call id (case-insensitive) and reports the count and names. Blob contents are never downloaded. At most 50 names are printed, with control and non-ASCII characters replaced by `?`. `--prefix` is required and must be 1 to 200 characters of letters, digits, `.`, `_`, `-`, `/`, so the tool never scans a whole container. The endpoint is `https://<account>.blob.core.windows.net`, so sovereign clouds are not supported.

Both checks always run, so one report shows every failure.

### Adding a LiveKit source

The Vapi check sits behind the `RetentionSource` interface in `src/retention/types.ts`: a `name` and a `check(callId)` that returns whether the call is complete and the status of each content field. A LiveKit source implements that interface, and the CLI needs no other change beyond constructing it.

### Limits of this check

- It reads one endpoint, `GET /call/{id}`. It does not request the separate recording and log download endpoints, and it does not look at Vapi dashboard data, webhooks you receive, or any copy outside Vapi.
- Content can appear some time after a call ends. A pass right after hangup is weaker than a pass later. Run it after Vapi has finished post-call processing.
- `monitor.listenUrl` and `monitor.controlUrl` are live-call URLs, not stored content, and are not checked. `assistantActivations` and `performanceMetrics` hold no conversation content and are not checked.
- Vapi's `GET /call/{id}` returns only what it holds, so a field that is absent might also be hidden from your key's role. Use a key with full read access.
- A Vapi artifact toggle in `assistant.artifactPlan` (recording, logging, packet capture, `transcriptPlan.enabled`) is what stops content being stored. This tool verifies the outcome. It does not set any of them.

### Dependency notes

`@azure/storage-blob` 12.32.0 and `@azure/identity` 4.13.0 are the newest releases that declare Node 20 support. The newer releases require Node 22. `npm audit --omit=dev` reports 3 moderate findings, all one `uuid` advisory (GHSA-w5hq-g745-h8pq, missing bounds check in v3, v5 and v6 when a buffer is supplied) reached through `@azure/msal-node`. This package does not call those functions. The fix arrives with identity 4.14, which needs Node 22. Identity 4.13.1 and 4.13.2 avoid it but pull in an `@azure/msal-node` with a high severity advisory, so 4.13.0 is the lower risk choice. Revisit when the repository moves to Node 22.
