# npm audit triage (P2-11)

Run periodically from the **repository root** (workspaces): `npm audit`. Last reviewed: 2026-04-22.

## Policy

- **High / critical** affecting **production** dependencies: fix, bump, or (with sign-off) document a temporary **exception** with owner + review date.
- **Development-only** (e.g. Vite dev server + **esbuild**): triage; often acceptable to defer with restriction “do not expose dev server to untrusted networks.”
- **Transitive** (e.g. old **fast-xml-parser** under **@aws-sdk**): prefer upgrading the **parent** package when a fixed release exists; use `overrides` only with regression testing.

## Known remaining issues (as of last run)

- **esbuild** (via `vite@6.x`): dev-server–scoped advisory; production static build does not ship the Vite dev server. **Mitigation:** don’t run `vite` dev on a public interface; use CI build for deploy artifacts. Upgrading to Vite 8+ may pull a newer esbuild; blocked until Storybook supports Vite 8 without `legacy-peer-deps` (see P2-02 follow-up in backlog).
- **@aws-sdk/\*** chain and **fast-xml-parser**: often cleared by AWS SDK minor bumps; re-run `npm update @aws-sdk/client-ssm` in Collect-RX-main and re-audit.
- **express** / **path-to-regexp**: `npm audit fix` may bump Express; confirm route behavior after upgrades.

## Commands

```bash
npm audit
npm audit fix          # non-breaking
# Breaking / major upgrades: do in a dedicated PR with `npm run ci:collectrx` green
```

## Related

- [RELEASING.md](./RELEASING.md) for versioned dependency upgrade windows.
