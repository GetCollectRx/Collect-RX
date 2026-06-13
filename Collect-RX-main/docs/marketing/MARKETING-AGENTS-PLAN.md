# CollectRx — Practice Partnerships (Marketing Agents)

**Status:** Unified on `feature/partnerships-marketing`  
**Supersedes:** draft PR #14 (`cursor/marketing-agents-1187`) — same agent goals, honest copy, single schema.

## Architecture

| Layer | Location |
|-------|----------|
| Data | `Prospect`, `ProspectActivity`, `MarketingScoreConfig`, `MarketingLearningRun` |
| API | `/api/admin/partnerships/*` (`partnershipsRouter.ts`) |
| UI | `/admin/partnerships` — kanban + table, prospect detail |
| Cadence | `sequenceEngine.ts` + BullMQ `MARKETING_SEQUENCE_TICK` |
| Learning | `marketingLearningJob.ts` + BullMQ `MARKETING_LEARNING_CYCLE` |
| Voice | `vapiSalesCall.ts` + `salesCallScript.ts` |
| Copy | `outreachVoice.ts`, `emailTemplates.ts`, `replyTemplates.ts` |

## Pipeline stages

`new → contacted → engaged → qualified → demo_booked → closed_won | closed_lost | opted_out`

SendGrid events and inbound replies auto-advance stages. Hot lead alerts fire on high-intent signals.

## Agents

1. **Prospect harvester** — Google Places, scored 0–100 using learned weights  
2. **Email cadence** — 4-step CASL-compliant sequence (standard templates, no fabricated intros)  
3. **Reply intelligence** — inbound parse + Gemini/heuristics  
4. **Sales qualifier** — Vapi outbound call  
5. **Call summary** — transcript → follow-up email  
6. **Referral engine** — post `closed_won` ask sequence  
7. **Score learning** — weekly job compares wins vs losses, retunes weights

## Self-tuning (Phase C)

See `prospectScoring.ts` and `marketingLearningJob.ts`. Weights stored in `marketing_score_config` (singleton). Audit in `marketing_learning_runs`.

Deploy: [PARTNERSHIPS-DEPLOY.md](./PARTNERSHIPS-DEPLOY.md) · CASL: [CASL-OUTREACH.md](./CASL-OUTREACH.md)
