---
type: community
cohesion: 0.50
members: 8
---

# Connect Module

**Cohesion:** 0.50 - moderately connected
**Members:** 8 nodes

## Intentional links

- **Upstream:** payment routes and webhooks → [[_COMMUNITY_Server Module]]; map → [[_MOC_COMMUNITY_Modules]].
- **Downstream:** [[connect.ts]], [[getStripe()]], [[handleWebhook()]], other members in this note.
- **Lateral:** [[_COMMUNITY_Encryption Module]], payment classes in Server cluster (`[[PaymentService]]`).

## Members
- [[SERVER_URL()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/stripe/connect.ts
- [[connect.ts]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/stripe/connect.ts
- [[createOnboardingLink()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/stripe/connect.ts
- [[generatePaymentLink()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/stripe/connect.ts
- [[getConnectAccount()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/stripe/connect.ts
- [[getStripe()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/stripe/connect.ts
- [[handleWebhook()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/stripe/connect.ts
- [[refreshAccountStatus()]] - code - /Users/khalidegeh/Desktop/Dentist/Click-main/src/server/stripe/connect.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Connect_Module
SORT file.name ASC
```
