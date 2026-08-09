# PRD: Phase 4 — Enterprise IT & Compliance

**Status**: Draft
**Author**: Alex (Product)
**Last Updated**: 2026-07-27
**Version**: 0.1
**Stakeholders**: Eng Lead, Khalid (founder/platform_dev), Security/Compliance reviewer, Sales (enterprise DSO deals)

---

## 1. Problem Statement

Phases 1–3 built the DSO data model — `Organization` / `OrganizationPractice` / `OrganizationMember`, consolidated org-level Stripe billing, pooled COGS, self-serve org creation and invites, and a `group_admin` console (`groupAdminRoutes.ts`). That work makes CollectRx *usable* by a multi-location dental group. It does not make CollectRx *procurable* by one.

Enterprise dental service organizations (10+ locations) run security and procurement reviews before signing, typically administered by an outsourced or in-house IT/security function, not the practice-facing buyer. Three requirements show up in nearly every DSO security questionnaire and MSA rider we've seen in this space:

1. Centralized identity — IT wants to provision/deprovision access to CollectRx the same way they do every other vendor: through their identity provider, not a password CollectRx stores.
2. Least-privilege internal roles — a DSO's controller or CFO's office wants visibility into consolidated billing and usage without being handed a role that can also see claim volumes, member management, or PMS import tooling.
3. Independent audit evidence — the DSO's own auditor (SOC 2 assessor, PIPEDA privacy officer, or external accounting firm) needs an export they can hand to a third party, not a JSON summary designed for our own dashboards.

**Evidence basis**: There is no active DSO customer generating support tickets on this today (platform has zero active practices as of this writing — this is a pre-sales/procurement gate, not a retention fix). The evidence here is competitive and procurement-pattern-based: SSO/SAML, granular RBAC, and auditor-ready exports are standard line items in enterprise security questionnaires (Vanta/Drata-style vendor risk reviews, SOC 2 vendor management sections) for any SaaS handling PHI-adjacent data. Treat this PRD as removing a **known sales blocker for the next DSO-tier deal**, not as a response to observed in-product pain. That distinction should inform sequencing (below) — build the highest-leverage, lowest-effort piece first, and let real DSO conversations validate which of the three actually gates a signature before over-investing in the most expensive one.

---

## 2. Goals & Success Metrics

| Goal | Metric | Baseline | Target | Measurement Window |
|------|--------|----------|--------|---------------------|
| Remove SSO as a deal blocker | # of DSO security questionnaires where SSO is marked "not supported" | Current: always | 0 | At next 3 DSO evaluations |
| Enable least-privilege billing access | # of org members who need `org_admin` (full access) solely to see billing | Unmeasured / assumed >0 | 0 for new controller-type invites | 90 days post-launch |
| Make compliance exports auditor-usable without engineering involvement | # of manual/ad-hoc export requests to eng per audit cycle | Unmeasured (no live org today) | 0 | First audit cycle post-launch |

These are procurement-readiness metrics, not usage-growth metrics — appropriate for a feature whose primary job is to not lose a deal, not to drive engagement.

---

## 3. Non-Goals

- **No OIDC/OAuth support in v1.** SAML 2.0 only. Every enterprise IdP we're likely to meet in this segment (Azure AD/Entra, Okta, OneLogin) speaks SAML; OIDC is a v2 addition once we see a real IdP that requires it.
- **No just-in-time (JIT) user auto-provisioning in v1.** A SAML assertion authenticates an *existing* CollectRx user (matched by email); it does not create one. Account creation still goes through the existing invite flow (`InviteToken`). This keeps SSO scoped to "replace the password," not "replace RBAC," and avoids silently granting access to anyone in the IdP's user directory.
- **No new practice-level role.** We are not expanding the seven-value `PracticeRole` enum. The controller persona is solved entirely at the `OrganizationMember.role` layer.
- **No SIEM streaming / webhook-based audit export.** Batch, on-demand export only. Revisit if a DSO's security team specifically requires log streaming (rare below enterprise-enterprise scale).
- **No exported PHI, ever.** Every export in this phase inherits the existing PHI boundary rule — patient tokens, not identifiers; aggregate counts and structured audit metadata, never transcript text or PHI values.
- **No self-serve SSO configuration UI in v1.** IdP metadata (SAML certificate, SSO URL, entity ID) is configured by `platform_dev` via a support-assisted setup, mirroring how admin-assisted org creation worked in Phase 1. A self-serve SSO config screen is a fast-follow once we've done this by hand two or three times and know the actual failure modes.

---

## 4. Target User

- **DSO IT/security administrator** — not a CollectRx end user. Cares about identity centralization, deprovisioning speed, and being able to answer "who has access and how do we know" for their own auditors. Primary consumer of FR-1 through FR-5 and FR-11–13.
- **DSO controller / finance lead** — wants recurring visibility into consolidated spend and usage without clinical/claims exposure. Primary consumer of FR-6–8.
- **DSO's external auditor** (SOC 2 assessor, privacy officer, accounting firm) — never logs into CollectRx directly; consumes the artifact the `org_admin` exports. Primary consumer of FR-9–10.

---

## 5. Functional Requirements

### SSO / SAML

1. An organization can be configured with a SAML 2.0 IdP connection (IdP SSO URL, X.509 certificate, entity ID) stored on a new `OrganizationSsoConfig` record, one per `Organization`.
2. `GET /api/auth/sso/:orgSlug/metadata` returns CollectRx's SP metadata XML for the IdP admin to consume during setup.
3. `POST /api/auth/sso/:orgSlug/login` (SP-initiated) redirects to the configured IdP; `POST /api/auth/sso/:orgSlug/acs` consumes the SAML assertion, matches the asserted email to an existing `User` row, and — on match — mints the same session cookie/JWT `respondPracticeLogin` already issues today. No new session shape; SSO is a new front door onto the existing auth token model.
4. If the asserted email has no matching `User`, the ACS handler returns a "contact your administrator" error — it must not create an account (see Non-Goals).
5. An `org_admin` can set `ssoEnforced: true` on their organization, which disables `/api/auth/login` (password) for any `User` whose email domain matches a configured SSO domain, except for `platform_dev` break-glass access. Enforcement is domain-based, checked at login time, not stored per-user.
6. Every SSO login and every SSO login failure (assertion parse error, unmatched email, expired assertion) is written to `AuditLog` with `action: 'auth.sso.login'` / `'auth.sso.login_failed'`.

### RBAC — org-level controller role

7. `OrganizationRole` gains a third value, `org_billing_viewer`, alongside the existing `org_admin` and `org_member`. A controller is provisioned as a normal `User` with `PracticeRole: accountant` (already `phiAccess: false` today) at a home practice, plus this org-level role.
8. `org_billing_viewer` may call `GET /api/group/billing` and `POST /api/group/billing/portal` (view/manage invoices via the Stripe portal). It may **not** call `POST /api/group/billing/checkout`, `PATCH /api/group/billing/cogs-pooling`, `/api/group/practices-summary`, `/api/group/compliance/export`, `/api/group/pms-import`, `/api/group/practices`, or any `/api/group/members` route. Each of these routes must explicitly check for `org_admin` and reject `org_billing_viewer` with 403, not merely omit a check.
9. `POST /api/auth/invite` accepts `role: 'accountant'` with an `orgRole: 'org_billing_viewer'` field when the inviter is an `org_admin`, creating the `OrganizationMember` row with the controller role on invite acceptance (mirroring the existing `group_admin`/`org_admin` co-invite path already in `authRoutes.ts`).

### Auditor-facing compliance export

10. A new `org_admin`-only endpoint `GET /api/group/compliance/export/v2?from=&to=` generates a bundle covering the given date range across all of the org's practices: (a) `AuditLog` entries, (b) `PhiAccessEvent` entries (actor, operation, record type, timestamp — never PHI values), (c) the org's user/member roster with role and active status as of export time, (d) `CarrierBlockEvent` history. Output is CSV (one file per category, zipped) — not raw JSON — so it is directly attachable to an auditor's workpapers.
11. Every export is itself recorded in a new `OrgComplianceExport` table (`organizationId`, `exportedBy`, `dateRangeFrom/To`, `checksum`, `createdAt`), mirroring the existing `EvidencePackExport` chain-of-custody pattern, so "who pulled an audit export and when" is itself answerable.
12. The v1 `GET /api/group/compliance/export` (aggregate counts) is retained unchanged for the existing internal/dashboard use case; `/v2` is additive, not a replacement.
13. The export must contain zero PHI by construction — this is enforced by only ever selecting from `AuditLog`, `PhiAccessEvent`, `OrganizationMember`/`User`, and `CarrierBlockEvent`, none of which store PHI values today.

---

## 6. Dependencies on Existing Schema

- SSO relies on `User.email` as the join key for assertion matching — requires email uniqueness (already enforced: `@unique` on `User.email`).
- The controller role reuses `PracticeRole.accountant`'s existing `phiAccess: false` semantics (`respondPracticeLogin` in `authRoutes.ts`) rather than introducing new PHI-access logic.
- `User.practiceId` is a required, non-nullable field (schema.prisma line 85) — a controller cannot exist as a pure org-only account with no home practice under the current model. FR-7 works around this by assigning a home practice, but this is a real schema constraint, not a design preference (see Open Questions).
- The audit export depends entirely on `AuditLog` and `PhiAccessEvent` being populated consistently across all write paths today — this PRD assumes but does not verify that coverage; see Open Questions.
- `runWithPracticeRls` iteration pattern (already used in `groupAdminRoutes.ts` for `/practices-summary`, `/compliance/export`, `/pms-import`) is the template for FR-10's per-practice data collection.

---

## 7. Open Questions

- [ ] Does `AuditLog` actually have full write coverage today, or only on the paths it was added for? A compliance export is only as credible as its input completeness — needs an audit-of-the-audit-log before FR-10 ships. Owner: Eng Lead. Deadline: before FR-10 dev start.
- [ ] Where does IdP metadata get stored securely (X.509 cert, SSO URL) — new table with encryption at rest, or reuse the pattern from `TriageCredential` (ciphertext/iv/authTag)? Recommend reusing that pattern rather than a new one. Owner: Eng Lead.
- [ ] What is the actual break-glass path if a DSO's IdP goes down and `ssoEnforced: true` locks out password login for their whole domain? Needs a documented `platform_dev`-assisted override before this ships to any real customer, not after the first incident.
- [ ] Should `org_billing_viewer` be able to see `subscriptionCurrentPeriodEnd` / `callsPaused` (operational signals) even though those are billing-adjacent, not pure invoice data? Current FR-8 says yes (they're part of `GET /billing`'s existing response shape) — flagging in case Sales/CS wants that narrower.

---

## 8. Sequencing & Priority

Ordered by effort-to-risk-reduction ratio, not by category importance:

1. **RBAC controller role (FR-7–9)** — smallest scope, no new tables, no new auth surface, purely additive enum value + route guards. Ship first; it's the cheapest procurement objection to remove and de-risks nothing else, so there's no reason to sequence it later.
2. **Auditor-facing export (FR-10–13)** — moderate scope (one new table, CSV generation, no new authentication surface). Ship second. Directly dependent on confirming `AuditLog`/`PhiAccessEvent` coverage first (see Open Questions) — that verification should start in parallel with #1.
3. **SSO/SAML (FR-1–6)** — largest scope and the only one requiring a new authentication code path, security review, and per-customer IdP integration testing with an actual DSO IT team. This is also the item most likely to have its real requirements shaped by the *specific* DSO we're closing next (Azure AD vs. Okta, JIT expectations, enforcement policy) — building it generically now, before a live deal is in late-stage procurement, risks building the wrong details twice. Recommend holding SSO until a DSO deal is contractually gated on it, then building against that customer's actual IdP rather than a hypothetical one.

**Confidence**: High on the RBAC and export scope (concrete, bounded, reuses existing patterns). Medium on SSO scope — the enforcement/break-glass/JIT questions above are exactly the kind of detail that tends to change once a real IT department is in the room.
