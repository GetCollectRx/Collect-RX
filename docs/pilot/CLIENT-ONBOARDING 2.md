# Client onboarding checklist (CollectRx)

Use this when a **new practice signs** for the AbelDent / desktop-connector pilot.  
Goal: **one-time setup (~30–60 min on site)**, then the practice does nothing daily — sync runs automatically.

**Related docs**

| Doc | Use for |
|-----|---------|
| [PRACTICE-ASK.md](./PRACTICE-ASK.md) | Send to the practice (what they need) |
| [INTERNAL-SETUP-RUNBOOK.md](./INTERNAL-SETUP-RUNBOOK.md) | Technical detail + API debugging |
| [SCHEMA-DISCOVERY-RUNBOOK.md](./SCHEMA-DISCOVERY-RUNBOOK.md) | Mapping AbelDent SQL on site |
| [GO-LIVE-ENGINEERING.md](../operations/GO-LIVE-ENGINEERING.md) | Stripe / Vapi / SendGrid when going live for real |

---

## Before the first onboarding call

- [ ] Production healthy: `https://www.collectrx.ca/api/health` → 200
- [ ] Downloads work: `https://www.collectrx.ca/download` → Windows installer downloads
- [ ] You can log in as platform admin / ops
- [ ] (Optional) Turn off Fly autostop if you want snappy first login — see [ALWAYS-ON.md](../operations/ALWAYS-ON.md)
- [ ] (When billing/calls go live) Stripe live + Vapi webhooks per [GO-LIVE-ENGINEERING.md](../operations/GO-LIVE-ENGINEERING.md)

---

## Day 0 — CollectRx ops (remote, ~15 min)

### 1. Create the practice

- [ ] Create practice in **Admin → Practices** (or invite flow)
- [ ] Invite **practice owner** email
- [ ] Practice settings:
  - **PMS:** AbelDent
  - **Ingest mode:** `desktop_connector`

### 2. Mint connector token

- [ ] Log in → **Admin → Sync ops** (`/admin/sync`)
- [ ] Click **Mint connector token**
- [ ] Save token in 1Password / secure note (**shown once**)
- [ ] Label: `CollectRx connector — [Practice name]`

### 3. Send the practice (email or onboarding packet)

- [ ] **Download:** https://www.collectrx.ca/download  
  - Windows: `CollectRx.Setup.1.0.0.exe`
- [ ] **Connector token** (secure channel — not email if you can avoid it; use 1Password share or phone)
- [ ] **Practice ask sheet:** [PRACTICE-ASK.md](./PRACTICE-ASK.md) (what they need on their side)
- [ ] **Schedule** Day 1 session with someone who can:
  - Install software on the AbelDent Windows PC
  - Provide SQL Server instance name
  - Run PowerShell as Administrator

**Email template (short)**

> 1. Install CollectRx from https://www.collectrx.ca/download  
> 2. We’ll configure the connector together on [date] — need one Windows PC that can reach your AbelDent SQL Server.  
> 3. Please have your AbelDent SQL instance name ready (e.g. `(local)\ABELDENT`).

---

## Day 1 — On-site or remote with IT (~30–60 min)

### 1. Install desktop agent (Windows)

- [ ] Run `CollectRx.Setup.1.0.0.exe` on the practice PC (LAN access to AbelDent SQL)
- [ ] Edit **`%ProgramData%\CollectRx\agent-config.json`**:

```json
{
  "apiUrl": "https://www.collectrx.ca",
  "apiToken": "<minted connector token>",
  "abeldentServer": "(local)\\ABELDENT",
  "abeldentDatabase": "AbelDent",
  "syncIntervalMinutes": 15
}
```

- [ ] Run **`desktop/scripts/windows-install-mssql.ps1`** as Administrator (ODBC + SQL driver)
- [ ] Launch CollectRx — tray icon appears; dashboard opens

### 2. Schema discovery (first practice / new SQL layout)

- [ ] Follow [SCHEMA-DISCOVERY-RUNBOOK.md](./SCHEMA-DISCOVERY-RUNBOOK.md) on the practice PC
- [ ] Confirm schema map saved / applied for this practice

### 3. Verify sync (CollectRx admin)

- [ ] **Admin → Sync ops** → connector status **Online** / **healthy**
- [ ] Recent **import run** → `success` or `partial` (not `validation_failed`)
- [ ] **Insurance → Queue** → work items appear for imported claims

### 4. Optional — test call

- [ ] Only if practice approves and Vapi/Stripe are live
- [ ] Trigger a single test call from queue; confirm disposition in claim detail

---

## Go-live sign-off (same day)

| Check | Pass? |
|-------|-------|
| Connector heartbeat &lt; 30 min old | ☐ |
| At least one successful import | ☐ |
| Claims visible in queue | ☐ |
| Practice owner can log in to dashboard | ☐ |
| Practice knows: tray app must stay running; PC needs outbound HTTPS | ☐ |

**Tell the practice**

- No daily CSV exports — agent syncs every ~15 minutes
- Emergency fallback: CSV upload in **Admin → Sync ops** if agent down &gt; 24h
- Support: your contact / support@collectrx.ca

---

## Week 1 after go-live

- [ ] Check **Admin → Sync ops** daily (connector not stale / error)
- [ ] Review ops alerts (`connector_stale`, `connector_sync_failed`) if enabled
- [ ] Do **not** ask for recurring CSVs unless connector is down
- [ ] Short check-in call with practice owner (day 3–5)

---

## Troubleshooting (quick)

| Symptom | Action |
|---------|--------|
| 401 on sync | Mint new token → update `agent-config.json` → revoke old token |
| Connector **stale** | PC asleep, app closed, or no internet — reopen app, wake PC |
| **mssql not available** | Re-run `windows-install-mssql.ps1` as Admin |
| SQL connection failed | Fix `abeldentServer` / Windows auth / firewall to SQL port |
| Import `validation_failed` | Sync ops run details → adjust schema map ([SCHEMA-DISCOVERY-RUNBOOK.md](./SCHEMA-DISCOVERY-RUNBOOK.md)) |
| Download link broken | Check `https://www.collectrx.ca/download`; verify `GITHUB_RELEASES_TOKEN` on Fly |

---

## What you do **not** need to redo per client

- Fly deploy / GitHub token (already set for `/download`)
- Desktop CI / installer build (use current release on `/download`)
- Engineering changes (unless new PMS or schema edge case)

---

## Links (bookmark)

| What | URL |
|------|-----|
| App login | https://www.collectrx.ca/login |
| Desktop download | https://www.collectrx.ca/download |
| Sync ops | https://www.collectrx.ca/admin/sync |
| Insurance queue | https://www.collectrx.ca/insurance |
| GitHub release (backup) | https://github.com/GetCollectRx/Collect-RX/releases/tag/v1.0.0-pilot |

---

*Last updated: 2026-07-09 — AbelDent desktop connector pilot*
