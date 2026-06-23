---
name: speckit-clarify
description: Identify underspecified areas in the current feature spec by asking up to 5 highly targeted clarification questions and encoding answers back into the spec.
argument-hint: "Optional areas to clarify in the spec"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

Goal: Detect and reduce ambiguity in the active feature specification and record clarifications directly in the spec file.

Run this BEFORE `/speckit.plan`. If user explicitly skips, warn that downstream rework risk increases.

1. **Setup**: Read `.specify/feature.json` to find `feature_directory` and derive `FEATURE_SPEC` path. If missing, instruct user to run `/speckit.specify` first.

2. Load `.specify/memory/constitution.md` for project principles and governance constraints.

3. **Load spec and scan for ambiguities** across these categories (mark each: Clear / Partial / Missing):
   - Functional Scope & Behavior (user goals, success criteria, out-of-scope declarations)
   - Domain & Data Model (entities, state transitions, data volume)
   - Interaction & UX Flow (user journeys, error/empty/loading states)
   - Non-Functional Quality (latency targets, scalability, reliability, security)
   - Integration & External Dependencies (external services, failure modes)
   - Edge Cases & Failure Handling
   - Completion Signals (acceptance criteria testability)

4. **Generate up to 5 clarification questions** (internally prioritized), each:
   - Answerable with a short multiple-choice (2-5 options) OR short phrase (≤5 words)
   - Materially impacts architecture, data modeling, task decomposition, security, or compliance
   - Addresses highest-impact unresolved categories first

5. **Sequential questioning loop** (one question at a time):
   - For multiple-choice: analyze all options, state your **Recommended** option with reasoning, then show table. After table: "Reply with the option letter, accept the recommendation by saying 'yes', or provide your own short answer."
   - For short-answer: state your **Suggested** answer with brief reasoning. "Accept by saying 'yes' or provide your own answer (≤5 words)."
   - Stop when: all critical ambiguities resolved, user signals done, or 5 questions asked.

6. **Integration after each accepted answer**:
   - Ensure `## Clarifications` section exists (create if missing)
   - Under it, create `### Session YYYY-MM-DD` subheading
   - Append: `- Q: <question> → A: <final answer>`
   - Apply clarification to the most appropriate spec section immediately
   - Save spec file after each integration

7. **Re-validate Spec Quality Checklist** if `FEATURE_DIR/checklists/requirements.md` exists:
   - Re-evaluate each checkbox against the updated spec
   - Update pass/fail status, report before/after counts

8. Write the updated spec back to `FEATURE_SPEC`.

## Completion Report

- Number of questions asked & answered
- Path to updated spec
- Sections touched
- Spec quality checklist status (before/after pass counts if checklist exists)
- Coverage summary per taxonomy category
- Suggested next command

## Done When

- [ ] Spec ambiguities identified and clarifications integrated into spec file
- [ ] Spec quality checklist re-validated (if exists)
- [ ] Completion reported with questions answered, sections touched, and coverage summary
