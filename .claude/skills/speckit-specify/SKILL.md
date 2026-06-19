---
name: speckit-specify
description: Create or update the feature specification from a natural language feature description.
argument-hint: "Describe the feature you want to specify"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

1. **Generate a concise short name** (2-4 words) for the feature:
   - Use action-noun format when possible (e.g., "add-user-auth", "fix-payment-bug")
   - Preserve technical terms and acronyms
   - Examples: "I want to add user authentication" → "user-auth"

2. **Create the spec feature directory**:
   - Read `.specify/init-options.json` for `feature_numbering` (default: "sequential")
   - If "sequential": scan `specs/` for existing directories, use the next 3-digit prefix (e.g., `003`)
   - If "timestamp": use `YYYYMMDD-HHMMSS`
   - Create directory: `specs/<prefix>-<short-name>/`
   - Copy `.specify/templates/spec-template.md` to `specs/<prefix>-<short-name>/spec.md`
   - Write `.specify/feature.json`:
     ```json
     { "feature_directory": "specs/<prefix>-<short-name>" }
     ```

3. **Load context**:
   - Load `.specify/memory/constitution.md` for project principles and governance constraints.
   - Load the spec template to understand required sections.

4. **Execute spec generation**:
   - Parse user description from `$ARGUMENTS`. If empty: ERROR "No feature description provided"
   - Extract key concepts: actors, actions, data, constraints
   - For unclear aspects, mark with `[NEEDS CLARIFICATION: specific question]` — maximum 3 markers
   - Prioritize clarifications: scope > security/privacy > user experience > technical details
   - Fill User Scenarios & Testing section with prioritized, independently testable user stories
   - Generate Functional Requirements (each must be testable)
   - Define Success Criteria (measurable, technology-agnostic)
   - Document Assumptions for all reasonable defaults chosen

5. **Write spec to file**: Replace template placeholders with concrete details.

6. **Spec Quality Validation**:
   - Create `specs/<feature-dir>/checklists/requirements.md` with quality checklist
   - Validate spec against: no implementation details, testable requirements, measurable success criteria, all mandatory sections complete
   - If `[NEEDS CLARIFICATION]` markers remain, present questions in table format (max 3) and wait for answers
   - Update spec with clarifications and re-validate

## Completion Report

Report:
- `specs/<feature-dir>/` — feature directory path
- `specs/<feature-dir>/spec.md` — spec file path
- Checklist results summary
- Readiness for next phase (`/speckit.clarify` or `/speckit.plan`)

## Quick Guidelines

- Focus on **WHAT** users need and **WHY** — not HOW to implement
- Written for business stakeholders, not developers
- Each user story must be independently testable and deliverable as an MVP increment

## Done When

- [ ] Specification written to `specs/<feature-dir>/spec.md` and validated
- [ ] `.specify/feature.json` written with resolved feature directory
- [ ] Completion reported with feature directory, spec file path, and checklist results
