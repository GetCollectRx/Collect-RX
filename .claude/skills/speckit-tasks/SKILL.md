---
name: speckit-tasks
description: Generate an actionable, dependency-ordered tasks.md for the feature based on available design artifacts.
argument-hint: "Optional task generation constraints"
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
   - `TASKS_FILE` = `FEATURE_DIR/tasks.md`

2. **Load design documents** from `FEATURE_DIR`:
   - **Required**: `plan.md` (tech stack, libraries, structure), `spec.md` (user stories with priorities)
   - **Optional**: `data-model.md`, `contracts/`, `research.md`, `quickstart.md`
   - Load `.specify/memory/constitution.md` for governance constraints

3. **Execute task generation**:
   - Extract tech stack, libraries, project structure from `plan.md`
   - Extract user stories with priorities (P1, P2, P3, etc.) from `spec.md`
   - Map entities from `data-model.md` to user stories (if exists)
   - Map interface contracts to user stories (if exists)
   - Extract technical decisions from `research.md` for setup tasks (if exists)
   - Generate tasks organized by user story
   - Generate dependency graph showing user story completion order

4. **Generate `tasks.md`** using `.specify/templates/tasks-template.md` structure:
   - Phase 1: Setup (project initialization)
   - Phase 2: Foundational (blocking prerequisites for all user stories)
   - Phase 3+: One phase per user story in priority order
   - Final Phase: Polish & cross-cutting concerns
   - All tasks MUST follow strict checklist format (see Task Format below)

## Task Format (REQUIRED)

Every task MUST follow: `- [ ] [TaskID] [P?] [Story?] Description with file path`

- **TaskID**: Sequential (T001, T002...)
- **[P]**: Include only if task is parallelizable (different files, no dependencies)
- **[Story]**: Required for user story phase tasks (US1, US2, US3...). Setup/foundational/polish phases: no story label
- **Description**: Clear action with exact file path

Examples:
- `- [ ] T001 Create project structure per implementation plan`
- `- [ ] T005 [P] Implement authentication middleware in src/middleware/auth.ts`
- `- [ ] T012 [P] [US1] Create Claim model in src/server/models/claim.ts`
- `- [ ] T014 [US1] Implement ClaimService in src/server/services/claimService.ts`

## Completion Report

Output:
- Path to generated `tasks.md`
- Total task count
- Task count per user story
- Parallel opportunities identified
- Suggested MVP scope (typically User Story 1 only)

## Done When

- [ ] `tasks.md` generated with all phases, task IDs, story labels, and file paths
- [ ] Completion reported with task count, story breakdown, and MVP scope
