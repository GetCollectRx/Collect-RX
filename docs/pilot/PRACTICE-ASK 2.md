# What we need from the practice (pilot)

CollectRx runs insurance A/R in the cloud. After a one-time setup, the practice does **not** export CSVs daily — a small desktop agent on your network keeps claims in sync.

## One-time setup (~30–60 minutes)

| Item | Why |
|------|-----|
| **One Windows PC on the office LAN** | Must reach AbelDent SQL Server (usually the AbelDent server or a workstation with DB access). |
| **SQL Server instance name** | e.g. `(local)\ABELDENT` or `192.168.1.10` — your IT or AbelDent vendor knows this. |
| **Permission to install CollectRx desktop** | Tray app + background sync; outbound HTTPS only (no inbound ports). |
| **One CollectRx login** | Practice owner signs in once to mint the connector token and confirm go-live. |
| **Outbound internet** | HTTPS to `https://www.collectrx.ca` (and API). |

## What the practice does **not** need to do ongoing

- No daily CSV exports
- No manual queue uploads
- No staff running sync scripts

The desktop agent syncs outstanding claims on a schedule (default every 15 minutes). CollectRx handles prioritization and carrier calls in the cloud.

## Fallback

If the desktop agent is offline, you can still upload a claim export CSV from **Admin → Sync ops** — this is for emergencies, not the normal workflow.

## Support contact

CollectRx team provides the installer link (`/download`) and connector token during onboarding.
