# Phase 6 — Learning & implementation loop

Autonomous pipeline: **Notion pull → research → bucket → rank → feasibility → implement → SMS**.

## Enable

1. Create a Notion integration and share your backlog database with it.
2. Set env on API + worker (same as other background jobs):

```bash
LEARNING_LOOP_ENABLED=1
NOTION_API_KEY=secret_...
NOTION_LEARNING_DATABASE_ID=...
LEARNING_CRON=0 6 * * *
LEARNING_FEASIBILITY_MIN=65
LEARNING_MAX_IMPLEMENT_PER_CYCLE=3
ALERT_SMS_TO=+1...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=...
```

3. Run migration: `npm run db:migrate` in `Collect-RX-main`.
4. **With Redis** — `docker compose up -d redis` (repo root), set `REDIS_URL=redis://127.0.0.1:6379`, run `npm run worker`.
5. **Without Redis** — `npm run dev` or `npm run start` runs the learning cron in-process when `LEARNING_LOOP_ENABLED=1`.
6. **One-off test** (no worker, no cron): `LEARNING_LOOP_ENABLED=1 npm run learning:cycle`

## Notion database

Expected properties (names are flexible; case-insensitive fallback):

| Property | Type |
|----------|------|
| Name / Title / Task | title |
| Status | status |
| Priority | select |
| Phase | select or text |
| Description / Notes | rich_text |
| Effort / Points | number (optional) |

Pull filter: statuses in `LEARNING_NOTION_STATUS_RESEARCH` (default: `Backlog`, `Ready for research`, `Not Started`).

## Research providers (Google Workspace friendly)

The loop **always** scans the local repo for anchor files, then adds **external** research when configured:

1. **NotebookLM** (default when `LEARNING_RESEARCH_PROVIDER=notebooklm`) — uses the community [`notebooklm-sdk`](https://www.npmjs.com/package/notebooklm-sdk) with a Google session (cookies or `npx notebooklm-sdk login`). Runs **NotebookLM “Research”** against a notebook you designate. **Not an official Google API** — treat as best-effort; pair with Gemini for production.
2. **Gemini + Google Search grounding** — set `GEMINI_API_KEY` (Google AI Studio or Cloud). Used automatically as **fallback** after NotebookLM, or as **primary** when `LEARNING_RESEARCH_PROVIDER=gemini`.
3. **Local only** — `LEARNING_RESEARCH_PROVIDER=local` skips external calls (offline / strict environments).

On a headless host: prefer **Gemini API key** (no cookie refresh). For NotebookLM on a server you must supply durable session material via `NOTEBOOKLM_COOKIES*` or a mounted `session.json` — interactive login is dev-only.

See `.env.example` (Phase 6 block) for all variables.

## What “implement” does

Safe, bounded actions only:

- Writes `docs/learning-autogen/<slug>.md` with research + scores
- Appends a research block to the Notion page
- Sets Notion status → `In progress` then `Done`

Does **not** auto-merge code or deploy.

## Observability

- Tables: `learning_cycle_runs`, `learning_candidates`
- Logs: `[learning]` prefix on API/worker stdout

## Manual run

```bash
cd Collect-RX-main
LEARNING_LOOP_ENABLED=1 npx tsx -e "
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { runLearningCycle } from './src/server/learning/cycle.ts';
const p = new PrismaClient();
runLearningCycle(p).then(console.log).finally(() => p.\$disconnect());
"
```
