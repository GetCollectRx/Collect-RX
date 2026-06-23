---
name: speckit-analyze
description: Perform a non-destructive cross-artifact consistency and quality analysis across spec.md, plan.md, and tasks.md after task generation.
argument-hint: "Optional focus areas for analysis"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Identify inconsistencies, duplications, ambiguities, and underspecified items across the three core artifacts (`spec.md`, `plan.md`, `tasks.md`) before implementation. This command runs only after `/speckit.tasks` has produced a complete `tasks.md`.

## STRICTLY READ-ONLY

Do **not** modify any files. Output a structured analysis report only.

**Constitution Authority**: The project constitution (`.specify/memory/constitution.md`) is non-negotiable. Constitution conflicts are automatically CRITICAL.

## Execution Steps

1. **Setup**: Read `.specify/feature.json` to find `feature_directory`. Abort with an error message if any required file is missing.

2. **Load artifacts**:
   - From `spec.md`: Overview, Functional Requirements, Success Criteria, User Stories, Edge Cases
   - From `plan.md`: Architecture/stack, Data Model, Phases, Technical constraints
   - From `tasks.md`: Task IDs, descriptions, phase grouping, parallel markers, file paths
   - From `.specify/memory/constitution.md`: principle validation

3. **Build semantic models**:
   - Requirements inventory: For each FR-### and SC-###, record a stable key
   - Task coverage mapping: Map each task to one or more requirements
   - Constitution rule set: Extract MUST/SHOULD normative statements

4. **Detection passes** (limit to 50 findings total):
   - **Duplication**: Near-duplicate requirements
   - **Ambiguity**: Vague adjectives (fast, scalable, secure) lacking measurable criteria; unresolved placeholders (TODO, ???)
   - **Underspecification**: Requirements missing measurable outcome; tasks referencing undefined components
   - **Constitution Alignment**: Requirements conflicting with a MUST principle
   - **Coverage Gaps**: Requirements with zero tasks; tasks with no mapped requirement; performance/security success criteria not in tasks
   - **Inconsistency**: Terminology drift; conflicting requirements; task ordering contradictions

5. **Severity assignment**:
   - **CRITICAL**: Violates constitution MUST; missing core artifact; requirement with zero coverage blocking baseline functionality
   - **HIGH**: Duplicate or conflicting requirement; ambiguous security/performance attribute; untestable acceptance criterion
   - **MEDIUM**: Terminology drift; missing non-functional task coverage; underspecified edge case
   - **LOW**: Style/wording improvements; minor redundancy

6. **Produce Analysis Report** (Markdown, no file writes):

```
## Specification Analysis Report

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|

**Coverage Summary Table:**
| Requirement Key | Has Task? | Task IDs | Notes |

**Constitution Alignment Issues:**
**Unmapped Tasks:**
**Metrics:** Total Requirements, Total Tasks, Coverage %, Ambiguity Count, Critical Issues Count
```

7. **Next Actions**: If CRITICAL issues exist, recommend resolving before `/speckit.implement`. If only LOW/MEDIUM, user may proceed with improvement suggestions.

8. **Offer Remediation**: Ask "Would you like me to suggest concrete remediation edits for the top N issues?" (Do NOT apply automatically.)

## Done When

- [ ] Analysis report produced (read-only — no files modified)
- [ ] Remediation offer presented
