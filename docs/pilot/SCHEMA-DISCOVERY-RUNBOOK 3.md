# AbelDent schema discovery — on-site runbook (<60 min)

Repeatable flow for mapping an AbelDent SQL Server database to CollectRx `schema-map.json`.

## Prerequisites

- Windows PC on the practice LAN with SQL access (same machine as CollectRx desktop agent)
- SQL Server instance name (e.g. `(local)\ABELDENT`)
- CollectRx connector token minted (Admin → Sync ops)
- Node.js 20+ (bundled with CollectRx desktop) or dev checkout

## Step 1 — Install SQL drivers (once per PC)

```powershell
# Run as Administrator on the practice PC
Set-ExecutionPolicy Bypass -Scope Process -Force
cd "C:\Program Files\CollectRx\resources\app\desktop\scripts"
.\windows-install-mssql.ps1
```

Or from a dev checkout:

```powershell
cd Collect-RX-main\desktop\scripts
.\windows-install-mssql.ps1
```

Requires: **ODBC Driver 17+ for SQL Server** (script installs via winget if missing).

## Step 2 — Discover tables and columns

```bash
cd Collect-RX-main
ABELDENT_SERVER='(local)\ABELDENT' ABELDENT_DATABASE=AbelDent npm run abeldent:discover
```

Output: `schema-discovery.json` in the working directory.

## Step 3 — Build and validate schema map

1. Copy `desktop/services/schema-map.example.json` → `schema-map.json`
2. Merge discovery output:

```bash
npm run abeldent:validate-queries -- --discovery schema-discovery.json --map schema-map.json
```

Fix any validation errors (missing columns, wrong table names).

3. Emit generated SQL templates:

```bash
npm run abeldent:emit-queries -- --map schema-map.json
```

## Step 4 — Point the agent at the map

In `%ProgramData%\CollectRx\agent-config.json`:

```json
{
  "schemaMap": "C:\\ProgramData\\CollectRx\\schema-map.json"
}
```

Copy `schema-map.json` to that path.

## Step 5 — Smoke sync

1. Launch CollectRx desktop (tray icon)
2. Admin → Sync ops → connector shows **Online**
3. Trigger **Sync now** from tray or Sync ops
4. Confirm import run `success` and claims appear in Insurance → Queue

## Troubleshooting

| Error | Fix |
|-------|-----|
| Login failed for user | Use Windows Integrated Auth; run desktop as user with SQL access |
| Invalid object name | Re-run discover; update `schema-map.json` table names |
| 401 on sync | Re-mint connector token; update `agent-config.json` |
| Column not found | Map field in `schema-map.json` mappings section |

## Artifacts to keep

- `schema-discovery.json` (dated)
- `schema-map.json` (practice-specific, store in 1Password + practice PC)
- Screenshot of successful import run in Sync ops
