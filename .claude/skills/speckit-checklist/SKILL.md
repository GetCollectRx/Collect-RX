---
name: speckit-checklist
description: Generate a custom requirements-quality checklist for the current feature based on user requirements.
argument-hint: "Domain or focus area for the checklist"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Checklist Purpose: "Unit Tests for English"

**CRITICAL CONCEPT**: Checklists are **UNIT TESTS FOR REQUIREMENTS WRITING** — they validate the quality, clarity, and completeness of requirements.

- NOT for: "Verify the button clicks correctly" or "Test error handling works"
- FOR: "Are visual hierarchy requirements defined for all card types?" or "Is 'prominent display' quantified with specific sizing/positioning?"

## Outline

1. **Setup**: Read `.specify/feature.json` to find `feature_directory`. All paths must be absolute.

2. Load `.specify/memory/constitution.md` if it exists.

3. **Clarify intent** (up to 3 contextual questions derived from `$ARGUMENTS` + spec signals):
   - Scope refinement, risk prioritization, depth calibration, audience framing
   - Skip individually if already unambiguous in `$ARGUMENTS`

4. **Load feature context**:
   - `spec.md`: Feature requirements and scope
   - `plan.md` (if exists): Technical details, dependencies
   - `tasks.md` (if exists): Implementation tasks

5. **Generate checklist** — "Unit Tests for Requirements":
   - Create `FEATURE_DIR/checklists/` directory if needed
   - Use short descriptive filename based on domain (`ux.md`, `api.md`, `security.md`, `performance.md`)
   - If file does NOT exist: create new, start IDs at CHK001
   - If file exists: append only, continuing from last CHK ID
   - **Never delete or replace existing checklist content**

   **Category structure**:
   - Requirement Completeness
   - Requirement Clarity
   - Requirement Consistency
   - Acceptance Criteria Quality
   - Scenario Coverage
   - Edge Case Coverage
   - Non-Functional Requirements
   - Dependencies & Assumptions
   - Ambiguities & Conflicts

   **Required patterns** (test requirements quality):
   - "Are [requirement type] defined/specified/documented for [scenario]?"
   - "Is [vague term] quantified/clarified with specific criteria?"
   - "Are requirements consistent between [section A] and [section B]?"
   - "Can [requirement] be objectively measured/verified?"
   - Include traceability references: `[Spec §X.Y]`, `[Gap]`, `[Ambiguity]`, `[Conflict]`

   **Prohibited patterns**:
   - ❌ "Verify", "Test", "Confirm", "Check" + implementation behavior
   - ❌ References to code execution, user actions, system behavior

6. **Report**: Output checklist path, item count, focus areas, and whether this was a new file or append.

## Done When

- [ ] Checklist generated at `FEATURE_DIR/checklists/<domain>.md`
- [ ] All items test requirements quality, not implementation
- [ ] Completion reported with path, item count, and focus areas
