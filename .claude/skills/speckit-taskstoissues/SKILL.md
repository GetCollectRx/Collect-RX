---
name: speckit-taskstoissues
description: Convert existing tasks into actionable GitHub issues for the feature based on available design artifacts.
argument-hint: "Optional filter or label for GitHub issues"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

1. **Setup**: Read `.specify/feature.json` to find `feature_directory`. Derive the path to `tasks.md`.

2. Load `.specify/memory/constitution.md` if it exists.

3. **Get Git remote**:
   ```bash
   git config --get remote.origin.url
   ```
   **ONLY PROCEED IF THE REMOTE IS A GITHUB URL.** If it is not, stop and inform the user.

4. **Read `tasks.md`** and extract all tasks with their IDs, descriptions, story labels, and parallel markers.

5. **Apply filter** (from `$ARGUMENTS` if provided — e.g., only US1 tasks, only P tasks, specific label).

6. **For each task**, use `gh issue create` to create a GitHub issue in the repository matching the remote URL:
   - Title: task description (without the checkbox/ID prefix)
   - Body: include Task ID, Story label, file path reference, and link to the feature spec
   - Labels: apply story label as a GitHub label if provided in `$ARGUMENTS`

   **CAUTION: NEVER create issues in repositories that do not match the remote URL.**

7. After all issues are created, output a summary with issue URLs.

## Done When

- [ ] All selected tasks converted to GitHub issues in the correct repository
- [ ] Summary reported with issue URLs and task-to-issue mapping
