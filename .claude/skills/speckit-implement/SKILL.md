---
name: speckit-implement
description: Execute the implementation plan by processing and executing all tasks defined in tasks.md
argument-hint: "Optional implementation guidance or task filter"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

1. **Setup**: Read `.specify/feature.json` to find `feature_directory`. Derive absolute paths.

2. **Check checklists status** (if `FEATURE_DIR/checklists/` exists):
   - Scan all checklist files
   - Count total vs. completed items per file
   - If any checklist is incomplete: display status table and ask "Some checklists are incomplete. Do you want to proceed with implementation anyway? (yes/no)"
   - Wait for user response before continuing

3. **Load implementation context**:
   - **Required**: `tasks.md`, `plan.md`
   - **If exists**: `data-model.md`, `contracts/`, `research.md`, `.specify/memory/constitution.md`, `quickstart.md`

4. **Project setup verification**:
   - Verify `.gitignore` contains essential patterns for the detected tech stack
   - Verify/create `.dockerignore` if Dockerfile exists
   - Append missing critical patterns only — never delete existing content

5. **Parse `tasks.md`**: Extract phases, task IDs, descriptions, file paths, parallel markers `[P]`, and story labels.

6. **Execute implementation** phase-by-phase:
   - Complete each phase before moving to the next
   - Run sequential tasks in order; parallel `[P]` tasks can run together
   - Respect file-level dependencies (tasks touching the same file run sequentially)
   - After each completed task: mark it `[X]` in `tasks.md`

7. **Progress tracking**:
   - Report progress after each completed task
   - Halt if any non-parallel task fails
   - For parallel tasks: continue successful ones, report failed ones
   - Provide clear error messages with debugging context

8. **Completion validation**:
   - Verify all required tasks are completed and marked `[X]`
   - Check that implemented features match the original specification
   - Confirm implementation follows the technical plan

## Completion Report

Summary of completed work: tasks completed, phases done, any blocked items.

## Done When

- [ ] All tasks in `tasks.md` completed and marked `[X]`
- [ ] Implementation validated against specification and plan
- [ ] Completion reported with summary of completed work
