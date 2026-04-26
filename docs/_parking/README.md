# Parked files (not forgotten)

## `ci-collectrx.yml`

GitHub rejected the initial `git push` because the machine’s Personal Access Token did not include the **`workflow`** scope, which is required to add or update files under `.github/workflows/`.

**To restore CI on the remote:**

1. Create a GitHub PAT with **`workflow`** (or use SSH / `gh` CLI with appropriate auth).
2. Move this file to `.github/workflows/ci-collectrx.yml` in the repo root and commit.
3. Push as usual.

Until then, the workflow only exists here as a copy.
