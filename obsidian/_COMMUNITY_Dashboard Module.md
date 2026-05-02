---
type: community
cohesion: 0.50
members: 3
---

# Dashboard Module

**Cohesion:** 0.50 - moderately connected
**Members:** 3 nodes

## Intentional links

- **Upstream:** APIs and auth → [[_COMMUNITY_Server Module]]; session gate → [[_COMMUNITY_Login Module]]; map → [[_MOC_COMMUNITY_Modules]].
- **Downstream:** [[Dashboard.tsx]], [[StageBadge()]], [[fmt()_1]].
- **Lateral:** [[_COMMUNITY_Table Module]], [[_COMMUNITY_Card Module]], [[_COMMUNITY_Badge Module]], [[_COMMUNITY_Skeletonloader Module]], [[_COMMUNITY_Users Module]] (Collect-RX dashboard variant).

## Members
- [[Dashboard.tsx]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/pages/Dashboard.tsx
- [[StageBadge()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/pages/Dashboard.tsx
- [[fmt()_1]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/pages/Dashboard.tsx

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Dashboard_Module
SORT file.name ASC
```
