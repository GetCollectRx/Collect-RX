---
type: community
cohesion: 0.50
members: 2
---

# Users Module

**Cohesion:** 0.50 - moderately connected
**Members:** 2 nodes

## Intentional links

- **Upstream:** backend for Collect-RX UI → [[_COMMUNITY_Server Module]]; map → [[_MOC_COMMUNITY_Modules]].
- **Downstream:** [[Dashboard.tsx_1]], [[MetricCard()]].
- **Lateral:** [[_COMMUNITY_Dashboard Module]] (Click `Dashboard.tsx` vs Collect-RX dashboard), [[_COMMUNITY_Card Module]], [[_COMMUNITY_Badge Module]].

## Members
- [[Dashboard.tsx_1]] - code - /Users/khalidegeh/Desktop/Dentist/collectrx-platform/src/frontend/components/Dashboard.tsx
- [[MetricCard()]] - code - /Users/khalidegeh/Desktop/Dentist/collectrx-platform/src/frontend/components/Dashboard.tsx

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Users_Module
SORT file.name ASC
```
