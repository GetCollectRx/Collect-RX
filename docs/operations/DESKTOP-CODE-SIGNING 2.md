# Desktop code signing (Windows + macOS)

Pilot builds ship **unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY=false` in CI). Users may see SmartScreen / Gatekeeper warnings until signing is enabled.

## When to enable

- Distributing outside trusted pilot practices
- Reducing “unknown publisher” friction on install

## Windows (Authenticode)

1. Purchase a code signing certificate (DigiCert, Sectigo, etc.).
2. Export as `.pfx` with password.
3. Set on CI / local build:

```bash
export CSC_LINK=/path/to/cert.pfx
export CSC_KEY_PASSWORD=...
export WIN_CSC_LINK=$CSC_LINK
export WIN_CSC_KEY_PASSWORD=$CSC_KEY_PASSWORD
```

4. Remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from `.github/workflows/collectrx-electron-installers.yml`.
5. Re-tag release (`v*`) to build signed `.exe`.

## macOS (notarization)

1. Apple Developer Program membership.
2. Create Developer ID Application certificate.
3. Set:

```bash
export CSC_LINK=... # .p12
export CSC_KEY_PASSWORD=...
export APPLE_ID=...
export APPLE_APP_SPECIFIC_PASSWORD=...
export APPLE_TEAM_ID=...
```

4. `electron-builder` notarizes when `hardenedRuntime` + credentials are set in `package.json` / `electron-builder` config.

## CI secrets (GitHub Actions)

| Secret | Purpose |
|--------|---------|
| `WIN_CSC_LINK` | Base64 `.pfx` or path via encrypted secret |
| `WIN_CSC_KEY_PASSWORD` | Certificate password |
| `APPLE_*` | Notarization (mac job) |

## Pilot decision

Unsigned builds are acceptable for **controlled pilot rollout** (practice IT installs manually). Enable signing before broad public download marketing.
