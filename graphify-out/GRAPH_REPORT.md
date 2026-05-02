# Graph Report - /Users/khalidegeh/Desktop/Dentist/collectrx-platform/src  (2026-04-27)

## Corpus Check
- Corpus is ~11,434 words - fits in a single context window. You may not need a graph.

## Summary
- 122 nodes · 107 edges · 36 communities detected
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_UI Icon Library|UI Icon Library]]
- [[_COMMUNITY_Email & Payment Services|Email & Payment Services]]
- [[_COMMUNITY_API Client & Auth Flow|API Client & Auth Flow]]
- [[_COMMUNITY_Estimates & Scheduler|Estimates & Scheduler]]
- [[_COMMUNITY_Template Engine & Helpers|Template Engine & Helpers]]
- [[_COMMUNITY_Frontend Format Utils|Frontend Format Utils]]
- [[_COMMUNITY_Auth Middleware|Auth Middleware]]
- [[_COMMUNITY_Database Seeding|Database Seeding]]
- [[_COMMUNITY_Patient AR Page|Patient AR Page]]
- [[_COMMUNITY_Balances Page|Balances Page]]
- [[_COMMUNITY_Authorization Middleware|Authorization Middleware]]
- [[_COMMUNITY_Practice Routes|Practice Routes]]
- [[_COMMUNITY_Dashboard Component|Dashboard Component]]
- [[_COMMUNITY_Sidebar Navigation|Sidebar Navigation]]
- [[_COMMUNITY_Server Entry|Server Entry]]
- [[_COMMUNITY_Scoped DB Context|Scoped DB Context]]
- [[_COMMUNITY_Cookie Auth Helpers|Cookie Auth Helpers]]
- [[_COMMUNITY_Validation Middleware|Validation Middleware]]
- [[_COMMUNITY_Payment Types|Payment Types]]
- [[_COMMUNITY_Email Types|Email Types]]
- [[_COMMUNITY_API Types|API Types]]
- [[_COMMUNITY_Practice Types|Practice Types]]
- [[_COMMUNITY_Patient Types|Patient Types]]
- [[_COMMUNITY_Type Index|Type Index]]
- [[_COMMUNITY_Auth Types|Auth Types]]
- [[_COMMUNITY_Request Context|Request Context]]
- [[_COMMUNITY_App Root|App Root]]
- [[_COMMUNITY_Frontend Entry|Frontend Entry]]
- [[_COMMUNITY_Vite Env Types|Vite Env Types]]
- [[_COMMUNITY_Analytics Page|Analytics Page]]
- [[_COMMUNITY_Admin Settings Page|Admin Settings Page]]
- [[_COMMUNITY_Report Page|Report Page]]
- [[_COMMUNITY_Dashboard Page|Dashboard Page]]
- [[_COMMUNITY_API Config|API Config]]
- [[_COMMUNITY_Webhooks Route|Webhooks Route]]
- [[_COMMUNITY_Patients Route|Patients Route]]

## God Nodes (most connected - your core abstractions)
1. `generateId()` - 8 edges
2. `WorkflowScheduler` - 5 edges
3. `PaymentService` - 4 edges
4. `EmailService` - 4 edges
5. `TemplateEngine` - 4 edges
6. `Filter()` - 3 edges
7. `setSessionPracticeId()` - 3 edges
8. `loginRequest()` - 3 edges
9. `generatePatients()` - 3 edges
10. `onSubmit()` - 2 edges

## Surprising Connections (you probably didn't know these)
- `onSubmit()` --calls--> `loginRequest()`  [INFERRED]
  /Users/khalidegeh/Desktop/Dentist/collectrx-platform/src/frontend/App.tsx → /Users/khalidegeh/Desktop/Dentist/collectrx-platform/src/frontend/hooks/useApi.ts
- `removeProcedure()` --calls--> `Filter()`  [INFERRED]
  src/frontend/components/EstimatesPage.tsx → src/frontend/components/Icons.tsx

## Communities

### Community 0 - "UI Icon Library"
Cohesion: 0.08
Nodes (0): 

### Community 1 - "Email & Payment Services"
Cohesion: 0.26
Nodes (3): EmailService, generateId(), PaymentService

### Community 2 - "API Client & Auth Flow"
Cohesion: 0.27
Nodes (6): onSubmit(), apiFetch(), getSession(), loginRequest(), setSessionPracticeId(), withDefaults()

### Community 3 - "Estimates & Scheduler"
Cohesion: 0.22
Nodes (3): removeProcedure(), Filter(), WorkflowScheduler

### Community 4 - "Template Engine & Helpers"
Cohesion: 0.29
Nodes (3): escapeHtml(), escapeRegex(), TemplateEngine

### Community 5 - "Frontend Format Utils"
Cohesion: 0.4
Nodes (0): 

### Community 6 - "Auth Middleware"
Cohesion: 0.67
Nodes (2): authenticate(), getBearerToken()

### Community 7 - "Database Seeding"
Cohesion: 0.83
Nodes (3): generatePatients(), pick(), seedDatabase()

### Community 8 - "Patient AR Page"
Cohesion: 0.5
Nodes (1): handleCopyPaymentLink()

### Community 9 - "Balances Page"
Cohesion: 0.67
Nodes (0): 

### Community 10 - "Authorization Middleware"
Cohesion: 0.67
Nodes (0): 

### Community 11 - "Practice Routes"
Cohesion: 0.67
Nodes (0): 

### Community 12 - "Dashboard Component"
Cohesion: 1.0
Nodes (0): 

### Community 13 - "Sidebar Navigation"
Cohesion: 1.0
Nodes (0): 

### Community 14 - "Server Entry"
Cohesion: 1.0
Nodes (0): 

### Community 15 - "Scoped DB Context"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Cookie Auth Helpers"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Validation Middleware"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Payment Types"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Email Types"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "API Types"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Practice Types"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Patient Types"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Type Index"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Auth Types"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Request Context"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "App Root"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Frontend Entry"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Vite Env Types"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Analytics Page"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Admin Settings Page"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Report Page"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Dashboard Page"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "API Config"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Webhooks Route"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Patients Route"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Dashboard Component`** (2 nodes): `MetricCard()`, `Dashboard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Sidebar Navigation`** (2 nodes): `Sidebar()`, `Sidebar.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Server Entry`** (2 nodes): `shutdown()`, `server.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Scoped DB Context`** (2 nodes): `scopedDb()`, `db.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cookie Auth Helpers`** (2 nodes): `authCookieOptions()`, `cookies.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Validation Middleware`** (2 nodes): `validate.ts`, `validate()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Payment Types`** (1 nodes): `payment.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Email Types`** (1 nodes): `email.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `API Types`** (1 nodes): `api.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Practice Types`** (1 nodes): `practice.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Patient Types`** (1 nodes): `patient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Type Index`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Auth Types`** (1 nodes): `auth.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Request Context`** (1 nodes): `main.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `App Root`** (1 nodes): `vite-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Frontend Entry`** (1 nodes): `AnalyticsPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Env Types`** (1 nodes): `AdminPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Analytics Page`** (1 nodes): `ReportPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Admin Settings Page`** (1 nodes): `DashboardPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Report Page`** (1 nodes): `context.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Dashboard Page`** (1 nodes): `config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `API Config`** (1 nodes): `webhooks.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Webhooks Route`** (1 nodes): `patients.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Patients Route`** (1 nodes): `auth.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Filter()` connect `Estimates & Scheduler` to `UI Icon Library`?**
  _High betweenness centrality (0.134) - this node is a cross-community bridge._
- **Why does `generateId()` connect `Email & Payment Services` to `Template Engine & Helpers`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `generateId()` (e.g. with `.generatePaymentLink()` and `.processPayment()`) actually correct?**
  _`generateId()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Should `UI Icon Library` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._