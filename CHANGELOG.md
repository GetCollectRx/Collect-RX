# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Phase 2 foundation: npm workspace for **Collect-RX-main**, `docker-compose` Postgres, Prisma **PostgreSQL** + baseline migration, CI (typecheck, lint, test, build), ESLint, Vitest smoke test, and documentation for database, releasing, and npm audit triage.
- Top-level `npm run dev` runs the **canonical** CollectRx app; `npm run dev:prototype` runs the legacy root Node entry.

### Changed

- **Vite 6** in Collect-RX-main to align with Storybook 8 peer ranges (removes the need for `--legacy-peer-deps` for a standard install).
- Prisma `datasource` is **PostgreSQL** via `DATABASE_URL` (replacing committed SQLite `file:./dev.db` for production alignment).

## [0.0.0] - 2026-04-22

- Changelog and releasing policy introduced; prior work untracked here.
