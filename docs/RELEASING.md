# Releases & version tags (P2-10)

## Versioning

- **Semantic versioning** for user-visible and API-impacting changes: `MAJOR.MINOR.PATCH`.
- **package.json** `version` in **Collect-RX-main** (and the repository root) should move together for releases, or only bump the **canonical** package you ship.

## Tagging

- Tag format: `v1.2.3` (optional prefix, e.g. `collectrx-v1.2.3`, if multiple products in one repo).
- Create an annotated tag after `main` (or the release branch) is green in CI.

## Changelog

- **`CHANGELOG.md`** at the repository root follows [Keep a Changelog](https://keepachangelog.com/) (Unreleased + dated sections under `##`).

## Release checklist (minimal)

1. `npm run ci:collectrx` passes locally (or review GitHub Actions).
2. Migrations are committed; `prisma migrate deploy` documented for the target environment.
3. `CHANGELOG.md` updated under **Unreleased**, then a version section added with the new tag.
4. Tag and push: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.

## Not every merge is a version bump

- Doc-only, internal refactors, or CI changes can ship without a new tag; accumulate under **Unreleased** until a product cut.
