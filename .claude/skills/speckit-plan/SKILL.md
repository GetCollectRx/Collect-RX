---
name: speckit-plan
description: Execute the implementation planning workflow using the plan template to generate design artifacts.
argument-hint: "Optional guidance for the planning phase"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

1. **Setup**: Read `.specify/feature.json` to find `feature_directory`. Derive absolute paths:
   - `FEATURE_DIR` = `<project_root>/<feature_directory>`
   - `FEATURE_SPEC` = `FEATURE_DIR/spec.md`
   - `IMPL_PLAN` = `FEATURE_DIR/plan.md`
   - Copy `.specify/templates/plan-template.md` to `IMPL_PLAN` if it doesn't exist yet.

2. **Load context**:
   - Read `FEATURE_SPEC`
   - Read `.specify/memory/constitution.md` for project principles and governance constraints

3. **Execute plan workflow**:
   - Fill Technical Context (mark unknowns as "NEEDS CLARIFICATION")
   - Fill Constitution Check section — verify compliance with all principles before proceeding
   - ERROR if any constitution violations are found and unjustified

4. **Phase 0: Outline & Research**
   - Extract unknowns from Technical Context → research tasks
   - Consolidate findings in `FEATURE_DIR/research.md`:
     - Decision: [what was chosen]
     - Rationale: [why chosen]
     - Alternatives considered: [what else evaluated]

5. **Phase 1: Design & Contracts**
   - Prerequisites: `research.md` complete
   - Extract entities from feature spec → `FEATURE_DIR/data-model.md`
   - Define interface contracts → `FEATURE_DIR/contracts/` (skip if purely internal project)
   - Create quickstart validation guide → `FEATURE_DIR/quickstart.md` (run/validation scenarios, not implementation code)

## Constitution Check (REQUIRED)

Before proceeding past this point, verify:
- [ ] PHI boundary respected — no patient identifiers reach Vapi
- [ ] CARRIER_BLOCK protocol honored if call scheduling is involved
- [ ] Carrier rules are data (carrier-configs.json), not code
- [ ] Call safety rules (hours, attempt limits, age thresholds) enforced if applicable
- [ ] Performance budgets in scope (2s dashboard, 200ms webhooks, paginated lists)

## Completion Report

Report branch (from git), `IMPL_PLAN` path, and generated artifacts: research.md, data-model.md, contracts/, quickstart.md.

## Done When

- [ ] Plan workflow executed and design artifacts generated
- [ ] Constitution Check passed
- [ ] Completion reported with plan path and generated artifacts
