# Paste-ready prompt — Security hardening follow-up (copy everything below the line)

---

Work in this repo's `Collect-RX-main/` workspace (the live app; root `src/` is legacy, not the active workspace). First read `docs/audits/FULL-SECURITY-AUDIT-2026-05-29.md` for context, and `docs/NPM-AUDIT.md` for the dependency-triage policy.

**Important:** that audit is from 2026-05-29. Three of its "recommended hardening" items are already done in current code — do NOT redo them, just confirm and move on:
- Item 0 (CSP): already enabled in `Collect-RX-main/src/server/index.ts` (`helmet({ contentSecurityPolicy: { directives: {...} } })`).
- Item 0b (hash reset tokens at rest): **done 2026-07-28.** `authRoutes.ts` now hashes tokens (SHA-256) via `hashResetToken()`/`issuePasswordResetToken()` before storing; the old plaintext admin-relay endpoint (`GET /reset-password/token/:userId`) was replaced with `POST /reset-password/resend/:userId`, which resends rather than reveals. See `docs/audits/FULL-SECURITY-AUDIT-2026-05-29.md` item 0b for the note. Task B below is removed — nothing left to do here.
- Item 7 (SAST in CI): already added (`Add Semgrep SAST to CI workflow` commit; check `.github/workflows/collectrx-ci.yml`).

Confirmed still open (verified by reading code directly, not trusting the doc):
- Item 1: no `will-navigate`/`will-redirect` handler in `Collect-RX-main/electron-shell/main.js`; `setWindowOpenHandler` there calls `shell.openExternal(url)` for anything starting with `http` — no host allowlist.
- `npm audit` findings have **drifted** from the audit's original list (qs/express are gone; current `npm audit --omit=dev` at repo root shows `fast-uri` (high) and `react-router`/`react-router-dom` (moderate) as production-dependency issues, plus an `esbuild`-via-`tsx` dev-only one). Triage fresh, don't assume the doc's list is current.

## Hard rules (stop conditions)
- Do not touch `src/server/outcomeConfidence.ts` or its gating logic — regression tests for it already exist (`tests/phase-5/dispatch-gate.test.ts`, `gate-supersession.test.ts`, `recovery-golden-path.test.ts`, etc.). If you believe coverage is genuinely missing, say so in your report; do not add speculative tests without checking first.
- Do not modify the CARRIER_BLOCK service.
- Do not run `npm audit fix --force` (breaking upgrades need a dedicated PR per `docs/NPM-AUDIT.md`).
- Do not print `.env` contents.
- If a step fails twice, stop and report exactly what you saw — do not iterate blindly.

## Task A — npm audit triage
1. From repo root: `npm audit --omit=dev` and, separately, `cd Collect-RX-main && npm audit --omit=dev`. Note discrepancies (workspaces can resolve differently).
2. For each production-dependency finding (currently `fast-uri`, `react-router`/`react-router-dom`): run `npm audit fix` (non-force), then `npm run test:collectrx` (or the workspace's `npm test`) to confirm nothing broke. `react-router` fix may bump a major version — if so, stop before accepting it and report the version jump instead of pushing through blind.
3. Leave the `esbuild`-via-`tsx` dev-only finding as a documented exception (matches existing policy for dev-server-only advisories) unless a non-breaking fix is available.
4. Update `docs/NPM-AUDIT.md`'s "Known remaining issues" section with today's date and what changed.

## Task B — REMOVED (done 2026-07-28, see note above)
Optional follow-up only if you have time: add/extend tests in `tests/` covering hashed reset-token lookup, expiry, single-use, and the new `POST /reset-password/resend/:userId` behavior — there wasn't a live `DATABASE_URL` available to run the DB-backed test suite when this was implemented, so it's worth a real run once you have one.

## Task C — Electron navigation lockdown
1. In `Collect-RX-main/electron-shell/main.js`, add `will-navigate` and `will-redirect` handlers on `mainWindow.webContents` that only allow navigation to the app's known origins (production + staging dashboard URLs, plus `localhost` in dev — check `electron-shell/main.js` and `.env.example` for how the origin is currently configured, e.g., an env var, and reuse that rather than hardcoding a second copy).
2. Change the `setWindowOpenHandler` at line ~325 from `if (url.startsWith('http')) shell.openExternal(url)` to require `https:` and match against the same origin allowlist (or a slightly broader "known link destinations" list if the app legitimately opens third-party links — check what it's used for first).
3. Check whether `Collect-RX-main/desktop/main.js` (the AbelDent sync utility) actually opens a `BrowserWindow` with untrusted/remote content, or whether it's headless (`utilityProcess`, no renderer). If headless, this item doesn't apply there — say so rather than adding dead code.
4. Run `npm run lint` and the relevant test suite before finishing.

## Final report format
Two sections: (1) npm audit — what was fixed, what's deferred and why; (2) Electron lockdown — done, with what allowlist was used. Nothing else.
