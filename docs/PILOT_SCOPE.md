# Pilot scope (single-practice validation)

**Project root:** `/Users/khalidegeh/Desktop/Dentist/collectrx-platform`

CollectRx is in **single-practice pilot mode** until an explicit **Day-90 decision** is recorded.

## Rules

- All product and engineering work targets **one pilot practice** (validation, not general rollout).
- **No multi-practice** onboarding, billing, or tenant features ship before the Day-90 gate.
- After Day-90, expansion work may start only if the decision is **`scale`**. If the decision is **`hold`** or **`pivot`**, do not start multi-practice work until a new program decision is recorded.

## Day-90 gate (required)

Before any expansion:

1. Assumption validation is documented (see `Product Requirement Document/phase-6-pilot-go-live.md` and Notion).
2. A one-line decision is recorded: `scale` | `hold` | `pivot`.
3. Stakeholders acknowledge the written guardrail in the project Notion and repository.

Keep this file in sync with Notion.
