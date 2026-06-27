# Claims UX Roadmap

**Status:** Complete  
**Completed:** 2026-06-26  
**Context:** Owner-facing UX aligned with [call-to-resolution architecture](../architecture/call-to-resolution.md)

This roadmap consolidates 24 recommendations from the Claims UX review. All items are **complete**.

---

## Implementation phases (complete)

| Phase | Scope | Recommendations | Status |
|-------|--------|-----------------|--------|
| 1 | Priority label fix + nav double-highlight | #1, #2, #23 | Complete |
| 2 | Owner read-only call loop visibility | #4, #13, #14, #24 | Complete |
| 3 | Claims hub — merge Work queue, gates, carrier intel | #3, #5, #6, #15, #16 | Complete |
| 4 | Claim detail timeline + next action | #9 | Complete |
| 5 | Unified priority engine | #10, #11 | Complete |
| 6 | Demo seed narrative | #17 | Complete |
| 7 | Dashboard command center + polish | #8, #12, #18–#22 | Complete |

---

## All recommendations

| # | Recommendation | Status | Where |
|---|----------------|--------|-------|
| 1 | Fix priority labels (0–1 vs 0–100) | Complete | `src/lib/workQueuePriority.ts` |
| 2 | Fix nav double-highlight on `/insurance/gates` | Complete | `src/App.tsx` |
| 3 | Merge Work queue + Insurance AR into Claims hub | Complete | `src/pages/InsuranceClaims.tsx` |
| 4 | Owner visibility without dial authority | Complete | `LiveActivityStrip`, list columns |
| 5 | Fold Carrier stats into Claims drill-down | Complete | Claims header link; demoted from owner nav |
| 6 | Gate inbox as Blocked gates tab | Complete | `/insurance?tab=blocked` |
| 7 | Split permissions matrix (see vs dial vs gates) | Complete | `OfficeGuide.tsx` — Who can do what |
| 8 | Dashboard as command center | Complete | `PracticeHealthBrief`, `TopMoneyAtRisk`, `LiveActivityStrip` |
| 9 | Claim detail timeline + next action | Complete | `ClaimTimeline.tsx` |
| 10 | One priority engine for UI + call queue | Complete | `priorityEngine.rankClaimForPractice` |
| 11 | Practice-facing priority floor ($2k+ / 45d+) | Complete | `applyPracticePriorityFloor` |
| 12 | Hero metrics: $ recovered, $ at risk >60d | Complete | Dashboard + PracticeHealthBrief |
| 13 | Close the loop in list row | Complete | Status, last outcome, recall on Claims |
| 14 | Live activity strip for all roles | Complete | `LiveActivityStrip.tsx` |
| 15 | Simplify owner nav | Complete | `PRACTICE_OWNER_SECTIONS` in `App.tsx` |
| 16 | Escalations as Needs human tab | Complete | `/insurance?tab=human` |
| 17 | Demo seed teaches the loop | Complete | `scripts/seed-demo.ts` |
| 18 | Separate pre-visit vs post-visit in nav | Complete | After visit / Before visit sidebar sections |
| 19 | Practice-language copy | Complete | `recoveryDisplay.ts`, Claims filters |
| 20 | Gates via dashboard Needs you + deep links | Complete | `PracticeHealthBrief`, notification hrefs |
| 21 | Role matrix documentation | Complete | `OfficeGuide.tsx` |
| 22 | Architecture doc UI map | Complete | `call-to-resolution.md` §12 |
| 23 | Unit tests for priority labels / ranker | Complete | `workQueuePriority.test.ts`, `workQueueRanker.test.ts` |
| 24 | QueueOverview data → owner live strip | Complete | `platformReports` activeCall + `LiveActivityStrip` |

---

## Demo walkthrough

**Login:** `demo@hasanfamilydental.ca` / `CollectRx2026!`  
**Seed:** `npm run demo:seed`

| Claim ref | Story |
|-----------|--------|
| `SL-2025-002341` | Live simulated call — Dashboard strip |
| `CL-2025-007712` | Blocked gate — attach perio chart |
| `GS-2025-009984` | Processing recall due now |
| `MAN-2025-004401` | High-value aging — top priority queue rank |

Simulated calls show a **Simulated call** badge when `vapiCallId` starts with `demo-`.

---

## Route map (final)

| Old route | New behavior |
|-----------|--------------|
| `/work-queue` | → `/insurance?tab=queue` |
| `/insurance/gates` | → `/insurance?tab=blocked` |
| `/insurance` | Claims hub (All \| Priority queue \| Blocked gates \| Needs human) |

---

## Tests

```bash
npm test -- tests/workQueuePriority.test.ts tests/workQueueRanker.test.ts tests/recoveryDisplay.test.ts
```
