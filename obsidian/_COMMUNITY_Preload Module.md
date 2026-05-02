---
type: community
cohesion: 0.50
members: 2
---

# Preload Module

**Cohesion:** 0.50 - moderately connected
**Members:** 2 nodes

## Intentional links

- **Upstream:** Electron / desktop host (see `[[main.js]]` / `[[main.js_1]]` in [[_COMMUNITY_Server Module]] members); map → [[_MOC_COMMUNITY_Modules]].
- **Downstream:** [[preload.js]], [[handler()]].
- **Lateral:** [[_COMMUNITY_Server Module]] (IPC targets HTTP API and sync).

## Members
- [[handler()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/desktop/preload.js
- [[preload.js]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/desktop/preload.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Preload_Module
SORT file.name ASC
```
