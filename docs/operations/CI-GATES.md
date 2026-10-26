# CI gates: what runs, what to require, how to change it

This is the reference for the pull request gates. Last verified against the workflows on the
`chore/ci-gates` branch. If the workflows change, change this file in the same pull request.

## The checks

| Check name | Workflow | What it proves |
| --- | --- | --- |
| `ci-gate` | `collectrx-ci.yml` | Every CI job passed (or was skipped for a correct reason). Require this one. |
| `pr-gate` | `pr-gate.yml` | The pull request description carries the pasted gate output. Require this one. |
| `Detect exposed secrets` | `secret-scanning.yml` | TruffleHog found nothing in the new commits. Require this one. |

The jobs behind `ci-gate` are `branch-up-to-date`, `static-gates`, `gate-parity`, `verify`,
`queue-redis`, `rls-strict`, `carrier-whitelist`, `e2e` and `perf-smoke`. Do not require them one
by one: a job that is renamed or skipped would leave a required name that never reports.

A push to a branch cancels the older run on that branch, and `ci-gate` in the cancelled run fails. It fails
on purpose, because a cancelled run proves nothing, and its log says so. Read the newest run, not the old one.

## Branch protection (rulesets, Settings, Rules, Rulesets)

The repository uses rulesets, not classic branch protection rules. State on 2026-10-26:

- `main-required-checks` requires `verify`, `Detect exposed secrets`, `ci-gate` and `pr-gate`, requires a
  pull request (0 approvals, so a sole maintainer can merge), and blocks deletion and force pushes.
  "Require branches to be up to date" is off, because it forces a rebase before every merge.
- `dev-required-checks` still requires only `verify` and `Detect exposed secrets`. Give it the same
  rules as `main` if `dev` is used.
- Both rulesets still let the repository admin role bypass them always, so an admin can push straight
  to `main`. Change the bypass to "For pull requests only" once a pull request has merged under the new
  rules, so a misconfiguration cannot lock the owner out.

There is no `prd` branch. It was decommissioned in PR #64 and the docs now say `main` is the
only shipping branch. Do not recreate it without a new decision.

## Pasting the gate output

Run `bash scripts/verify-all.sh` and paste its last line under "Gate output" in the pull request
description, for example `VERIFY-ALL: PASS (18 passed)`. An UNVERIFIED line is accepted only with a
line `UNVERIFIED acknowledged by @owner`. The check is self-attested: it makes a missing or red
gate a visible statement, and the CI jobs still run for real. A pull request runs the scripts from
its own branch, so changes to `scripts/check-pr-body.sh` need a reviewer.

## Dependency audit policy

- Pull requests block on **critical** production advisories (`verify` job, and `verify-all.sh`).
- `dependency-audit.yml` runs every Monday at **high**. A failing run starts a 72 hour window to
  patch, normally with `npm audit fix` on a branch.
- Reason: a newly published advisory against an unchanged lockfile used to turn `main` red with no
  bad commit. Critical findings still stop work immediately.

## Why a push sometimes shows every job skipped

A push to a branch that has an open pull request is covered by the pull request run of the same
commit, so the push run skips its jobs (the `trigger` job decides, and `ci-gate` accepts it).
Pushes still run in full when there is no open pull request, when the pull request has merge
conflicts (GitHub does not start pull request runs then), and whenever the lookup is unsure.

## Keeping the hook and CI in parity

`.githooks/pre-push` runs `scripts/verify-all.sh --full`. The `gate-parity` job runs
`scripts/check-gate-parity.sh`, which fails if:

- a CI `verify` step is neither a mapped gate, setup plumbing, nor a declared CI-only step
- a `verify-all.sh` gate has no entry in `scripts/gate-parity.map`
- the audit severity differs between CI and `verify-all.sh`
- the hook no longer runs the full gates, or `npm install` no longer installs the hook

To add a gate: add `gate_<id>` and a `run_gate` line to `verify-all.sh`, add the CI step (or add the
id to the `static-gates` `--only` list), add a `GATE` line to `scripts/gate-parity.map`, and add a
case to the matching self-test script. All three self-tests run in the `static-gates` job.

## Known limits

- The hook cannot run for pushes made through an API or connector, or with `--no-verify`. The CI
  checks above are the backstop.
- `pr-gate` cannot prove the pasted output is genuine.
- The trigger lookup fails open: when unsure it runs the jobs, so duplicates are possible but a
  commit never goes unchecked.
