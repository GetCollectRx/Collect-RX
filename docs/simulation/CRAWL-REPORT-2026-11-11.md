# CollectRx application crawl report

Generated 2026-11-11T16:18:13.267Z. Synthetic data, contained run.

Page visits as an allowed role: **235**. WORKS 191, PARTLY 34, BROKEN 10.
Button clicks on pages the office manager can reach: **95**. WORKS 85 (something visibly happened), PARTLY 10 (no visible effect or could not be clicked), BROKEN 0 (an error or crash).
Pages where the browser blocked an inline event handler under the app's own security policy: **371** (counted once here, not per page).
Visits as a role the router refuses: **136**. DENIED 136, LEAKS 0.

## Roles used

| Role | Persona the app assigned | How it was created |
|---|---|---|
| owner | practice_owner | signup |
| office_manager | practice_owner | invited |
| billing_coordinator | practice_owner | invited |
| front_desk | front_desk | invited |
| accountant | auditor | invited |
| auditor | none | could not be created through the invite API |
| group_admin | billing_ops_manager | organization signup |
| anonymous | anonymous | no login |
| platform_admin | none | a platform user cannot be created through the product; untested |

## Scorecard (rows are routes, columns are roles)

| Route | Component | owner | office_manager | billing_coordinator | front_desk | accountant | group_admin | anonymous |
|---|---|---|---|---|---|---|---|---|
| /console | LiveConsole | DENIED | DENIED | DENIED | PARTLY | DENIED | DENIED | DENIED |
| /history | CallHistory | DENIED | DENIED | DENIED | PARTLY | DENIED | DENIED | DENIED |
| /dashboard | Dashboard | WORKS | WORKS | WORKS | DENIED | DENIED | PARTLY | DENIED |
| /reports/aging | AgingReport | WORKS | WORKS | WORKS | DENIED | BROKEN | PARTLY | DENIED |
| /reports/carriers | CarrierStats | WORKS | WORKS | WORKS | DENIED | BROKEN | PARTLY | DENIED |
| /reports/queue | QueueStatsReport | WORKS | WORKS | WORKS | DENIED | BROKEN | PARTLY | DENIED |
| /settings | PracticeSettings | WORKS | WORKS | WORKS | DENIED | DENIED | DENIED | DENIED |
| /escalations | Escalations | WORKS | WORKS | WORKS | PARTLY | DENIED | PARTLY | DENIED |
| /portfolio | Portfolio | DENIED | DENIED | DENIED | DENIED | DENIED | PARTLY | DENIED |
| /admin | AdminPractices | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |
| /admin/partnerships | PartnershipsBoard | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |
| /admin/partnerships/:id | ProspectDetail | UNTESTED | UNTESTED | UNTESTED | UNTESTED | UNTESTED | UNTESTED | UNTESTED |
| /admin/health | SystemHealth | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |
| /admin/users | UserManagement | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |
| /admin/break-glass | BreakGlass | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |
| /admin/staff | UsersAdmin | WORKS | WORKS | WORKS | DENIED | DENIED | DENIED | DENIED |
| /admin/integrations | Admin | WORKS | WORKS | WORKS | DENIED | DENIED | DENIED | DENIED |
| /admin/runbook | PilotRunbook | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |
| /guide | OfficeGuide | WORKS | WORKS | WORKS | PARTLY | PARTLY | PARTLY | WORKS |
| /download | DesktopDownload | WORKS | WORKS | WORKS | PARTLY | PARTLY | PARTLY | WORKS |
| /work-queue | WorkQueue | WORKS | WORKS | WORKS | DENIED | DENIED | PARTLY | DENIED |
| /insurance | InsuranceClaims | WORKS | WORKS | WORKS | DENIED | DENIED | PARTLY | DENIED |
| /ar-command-center | ArCommandCenter | WORKS | WORKS | WORKS | DENIED | DENIED | PARTLY | DENIED |
| /import | CsvImportPage | WORKS | WORKS | WORKS | DENIED | DENIED | PARTLY | DENIED |
| /insurance/:id | InsuranceClaimDetail | PARTLY | PARTLY | PARTLY | DENIED | DENIED | BROKEN | DENIED |
| /admin/sync | SyncOpsDashboard | WORKS | WORKS | WORKS | DENIED | DENIED | PARTLY | DENIED |
| /analytics | Analytics | WORKS | WORKS | WORKS | DENIED | BROKEN | BROKEN | DENIED |
| /validation | AssumptionValidation | WORKS | WORKS | WORKS | DENIED | DENIED | BROKEN | DENIED |
| /usage-insights | ProductUsageAnalytics | WORKS | WORKS | WORKS | DENIED | DENIED | DENIED | DENIED |
| /billing | PracticeBillingPage | WORKS | WORKS | WORKS | DENIED | PARTLY | DENIED | DENIED |
| /pre-visit | PreVisitCommandCenter | WORKS | WORKS | WORKS | DENIED | DENIED | PARTLY | DENIED |
| /pre-treatment-estimate | PreTreatmentEstimate | WORKS | WORKS | WORKS | DENIED | DENIED | PARTLY | DENIED |
| /pre-visit-blueprint | PreVisitBlueprintPage | WORKS | WORKS | WORKS | PARTLY | DENIED | PARTLY | DENIED |
| /canadian-2026 | CanadianExpansion | WORKS | WORKS | WORKS | DENIED | DENIED | BROKEN | DENIED |
| /group-dashboard | GroupDashboard | DENIED | DENIED | DENIED | DENIED | DENIED | PARTLY | DENIED |
| /group/pms-import | GroupPmsImportPage | DENIED | DENIED | DENIED | DENIED | DENIED | PARTLY | DENIED |
| /login | LoginPage | WORKS | WORKS | WORKS | PARTLY | BROKEN | PARTLY | WORKS |
| / | MarketingSite | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /landing | MarketingSite | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /reset-password | ResetPasswordPage | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /signup | SignupPage | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /accept-invite | AcceptInvitePage | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /legal/terms | LegalTerms | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /legal/privacy | LegalPrivacy | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /product | ProductOnePager | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /changelog | Changelog | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /demo | PublicDemoRoute | WORKS | WORKS | WORKS | PARTLY | BROKEN | PARTLY | WORKS |
| /how-it-works | MarketingSite | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /roi | MarketingSite | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /pricing | MarketingSite | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /features | MarketingSite | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /carriers | MarketingSite | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /compliance | MarketingSite | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |
| /about | MarketingSite | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS | WORKS |

## Every problem found

| Verdict | Role | Route | Evidence |
|---|---|---|---|
| PARTLY | owner | /insurance/3028b6f5-15e8-4a38-aa7d-808cb8157b83 | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/insurance/claims/3028b6f5-15e8-4a38-aa7d-808cb8157b83/evidence 403 |
| PARTLY | office_manager | /insurance/3028b6f5-15e8-4a38-aa7d-808cb8157b83 | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/insurance/claims/3028b6f5-15e8-4a38-aa7d-808cb8157b83/evidence 403 |
| PARTLY | billing_coordinator | /insurance/3028b6f5-15e8-4a38-aa7d-808cb8157b83 | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/insurance/claims/3028b6f5-15e8-4a38-aa7d-808cb8157b83/evidence 403 |
| PARTLY | front_desk | /console | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | front_desk | /history | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | front_desk | /escalations | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | front_desk | /guide | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | front_desk | /download | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | front_desk | /pre-visit-blueprint | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | front_desk | /login | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | front_desk | /demo | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| BROKEN | accountant | /reports/aging | crash screen |
| BROKEN | accountant | /reports/carriers | crash screen |
| BROKEN | accountant | /reports/queue | crash screen |
| PARTLY | accountant | /guide | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | accountant | /download | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| BROKEN | accountant | /analytics | crash screen |
| PARTLY | accountant | /billing | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| BROKEN | accountant | /login | crash screen |
| BROKEN | accountant | /demo | crash screen |
| PARTLY | group_admin | /dashboard | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /reports/aging | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /reports/carriers | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /reports/queue | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /escalations | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /portfolio | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /guide | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /download | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /work-queue | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /insurance | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /ar-command-center | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /import | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| BROKEN | group_admin | /insurance/3028b6f5-15e8-4a38-aa7d-808cb8157b83 | crash screen |
| PARTLY | group_admin | /admin/sync | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| BROKEN | group_admin | /analytics | crash screen |
| BROKEN | group_admin | /validation | crash screen |
| PARTLY | group_admin | /pre-visit | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403, GET /api/analytics/phase5-kpis 403 |
| PARTLY | group_admin | /pre-treatment-estimate | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /pre-visit-blueprint | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| BROKEN | group_admin | /canadian-2026 | crash screen |
| PARTLY | group_admin | /group-dashboard | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /group/pms-import | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /login | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | group_admin | /demo | console: Failed to load resource: the server responded with a status of 403 (Forbidden); failed calls: GET /api/billing/plan 403 |
| PARTLY | office_manager | /reports/carriers [button: 30d] | no visible effect: no navigation, no page change, no API call |
| PARTLY | office_manager | /settings [button: Encrypt and enroll] | could not be clicked |
| PARTLY | office_manager | /settings [button: Test local connection] | could not be clicked |
| PARTLY | office_manager | /settings [button: Add mapping] | no visible effect: no navigation, no page change, no API call |
| PARTLY | office_manager | /work-queue [button: Priority queue] | no visible effect: no navigation, no page change, no API call |
| PARTLY | office_manager | /insurance [button: All claims] | no visible effect: no navigation, no page change, no API call |
| PARTLY | office_manager | /analytics [button: 30 days] | no visible effect: no navigation, no page change, no API call |
| PARTLY | office_manager | /validation [button: Day 30] | no visible effect: no navigation, no page change, no API call |
| PARTLY | office_manager | /pre-treatment-estimate [button: Generate estimate] | could not be clicked |
| PARTLY | office_manager | /canadian-2026 [button: Add procedure row] | no visible effect: no navigation, no page change, no API call |

## Anonymous API probe

135 static API paths from the frontend, requested with no login. Refused (401 or 403): 129. Answered 200 without a login: 6. Server error: 0. Other: 0.

Answered 200 with no login (check each is meant to be public):

- `/api/desktop/releases`
- `/api/diagnostics`
- `/api/health`
- `/api/health/live`
- `/api/health/metrics`
- `/api/health/ready`

