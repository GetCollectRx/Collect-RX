---
name: speckit-constitution
description: Create or update the project constitution from interactive or provided principle inputs, ensuring all dependent templates stay in sync.
argument-hint: "Principles or values for the project constitution"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

Check if `.specify/extensions.yml` exists in the project root. If it exists, read it and look for entries under the `hooks.before_constitution` key. Skip hook processing silently if the file is missing or unparseable.

## Outline

You are updating the project constitution at `.specify/memory/constitution.md`. This file is a TEMPLATE containing placeholder tokens in square brackets (e.g. `[PROJECT_NAME]`, `[PRINCIPLE_1_NAME]`). Your job is to (a) collect/derive concrete values, (b) fill the template precisely, and (c) propagate any amendments across dependent artifacts.

**Note**: If `.specify/memory/constitution.md` does not exist yet, copy `.specify/templates/constitution-template.md` there first.

Follow this execution flow:

1. Load the existing constitution at `.specify/memory/constitution.md`.
   - Identify every placeholder token of the form `[ALL_CAPS_IDENTIFIER]`.
   - The user might require less or more principles than the template. Respect that — update the doc accordingly.

2. Collect/derive values for placeholders:
   - If user input (conversation) supplies a value, use it.
   - Otherwise infer from existing repo context (README, docs, CLAUDE.md, prior constitution versions).
   - For governance dates: `RATIFICATION_DATE` is the original adoption date (if unknown, use today or mark TODO). `LAST_AMENDED_DATE` is today if changes are made.
   - `CONSTITUTION_VERSION` must increment according to semantic versioning:
     - MAJOR: Backward-incompatible governance/principle removals or redefinitions.
     - MINOR: New principle/section added or materially expanded guidance.
     - PATCH: Clarifications, wording, typo fixes.

3. Draft the updated constitution content:
   - Replace every placeholder with concrete text (no bracketed tokens left).
   - Each Principle section: succinct name, paragraph capturing non-negotiable rules, rationale if not obvious.
   - Governance section lists amendment procedure, versioning policy, and compliance review expectations.

4. Consistency propagation — check and update if needed:
   - `.specify/templates/plan-template.md` — ensure "Constitution Check" section aligns.
   - `.specify/templates/spec-template.md` — scope/requirements alignment.
   - `.specify/templates/tasks-template.md` — task categorization reflects current principles.

5. Produce a Sync Impact Report (prepend as an HTML comment at top of the constitution file after update):
   - Version change: old → new
   - List of modified principles
   - Added / removed sections
   - Templates requiring updates (✅ updated / ⚠ pending)

6. Validation before final output:
   - No remaining unexplained bracket tokens.
   - Version line matches report.
   - Dates in ISO format YYYY-MM-DD.
   - Principles are declarative and free of vague language ("should" → MUST/SHOULD with rationale).

7. Write the completed constitution back to `.specify/memory/constitution.md` (overwrite).

8. Output a final summary:
   - New version and bump rationale.
   - Any files flagged for manual follow-up.
   - Suggested commit message.

## Post-Execution Checks

Check if `.specify/extensions.yml` exists and look for `hooks.after_constitution` entries. Skip silently if missing or unparseable.

## Done When

- [ ] Constitution written to `.specify/memory/constitution.md` with no placeholder tokens remaining
- [ ] Sync Impact Report prepended as HTML comment
- [ ] Summary reported to user with version, bump rationale, and suggested commit message
