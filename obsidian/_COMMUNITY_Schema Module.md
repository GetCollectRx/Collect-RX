---
type: community
cohesion: 0.50
members: 16
---

# Schema Module

**Cohesion:** 0.50 - moderately connected
**Members:** 16 nodes

## Intentional links

- **Upstream:** patient / estimate flows → [[_COMMUNITY_Server Module]]; map → [[_MOC_COMMUNITY_Modules]].
- **Downstream:** [[schema.ts]], [[calculator.ts]], benefit helpers listed in members.
- **Lateral:** [[_COMMUNITY_Pretreatmentestimate Module]], [[_COMMUNITY_Coveragebreakdown Module]], [[_COMMUNITY_Seedcdtcodes Module]].

## Members
- [[addUsedAmount()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[calculateEstimate()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/calculator.ts
- [[calculator.ts]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/calculator.ts
- [[cdtToCategory()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[getBenefits()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[getCoverage()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[getCoverageForCategory()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[getCurrentBenefits()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[getPendingClaimsTotal()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[getPlanYear()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[markStale()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[schema.ts]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[updateLastServiceDate()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[upsertBenefits()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[upsertCoverage()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts
- [[upsertPlanYear()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/benefits/schema.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Schema_Module
SORT file.name ASC
```
