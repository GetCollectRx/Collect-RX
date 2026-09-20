# CollectRx — Access Control System Handoff

**Prepared for:** Cursor / Developer Implementation  
**Prepared by:** Khalid Egeh (via Claude Cowork)  
**Date:** 2026-05-20  
**Status:** Ready for Implementation

---

## 1. Context & Purpose

CollectRx is an AI-driven dental insurance collections platform. An autonomous AI agent works claims on behalf of dental practices — calling insurers, tracking statuses, and resolving outstanding balances. Humans interact with the system for escalations, configuration, reporting, and oversight.

This document defines the **role-based access control (RBAC) model** for the CollectRx platform, covering current needs (single practice) and the planned expansion toward a multi-practice Canadian dental standard.

The access control model must be designed to scale from **day one**: a single-practice deployment should feel like a subset of the multi-practice model, not a different system.

---

## 2. System Resources & Actions

These are the authoritative resources and actions derived from the CollectRx MCP tool surface:

| Resource | Actions |
|----------|---------|
| **Practices** | `list_practices`, `get_practice`, `update_practice` |
| **Claims** | `list_claims`, `get_claim`, `pause_claim`, `unpause_claim` |
| **Queue** | `build_queue`, `run_queue`, `get_queue_stats` |
| **Escalations** | `list_escalations`, `resolve_escalation` |
| **Reports** | `get_aging_report`, `get_carrier_stats` |

**Queue note:** `build_queue` and `run_queue` are **fully automated** — no human role triggers these in normal operation. They are exposed only to the Platform Admin as a break-glass override. Do not surface these in any UI for other roles.

---

## 3. Roles (Personas)

### Role 1: `front_desk`
**Display name:** Front Desk Staff  
**Scope:** Single practice (their assigned practice only)  
**Current:** Yes  

**Who they are:** Practice reception and admin staff. They interact with CollectRx reactively — patients ask about claim status, insurers call about escalations, or a claim needs to be held pending a dispute. They are not financial analysts; they should not see aging reports or carrier intelligence.

**What they need:**
- Look up claim status for a patient or insurer inquiry
- Pause a claim (e.g., patient dispute, incorrect procedure code)
- Unpause a claim once resolved
- View and resolve escalations (they have full resolution authority — no owner approval required)

**What they must not access:**
- Financial reports (aging, carrier stats)
- Practice configuration
- Claims outside their assigned practice
- Queue controls

---

### Role 2: `practice_owner`
**Display name:** Practice Owner / Dentist  
**Scope:** Single practice (their own practice only)  
**Current:** Yes  

**Who they are:** The dentist and/or business owner. The highest-trust role within a practice. They make financial and operational decisions and need full visibility into their practice's performance. They own the practice configuration.

**What they need:**
- Full claim-level access (view, pause, unpause)
- View and resolve escalations
- Aging report (outstanding AR by carrier and bucket)
- Carrier performance stats (confidence scores, success rates)
- Queue stats (how many claims are queued, in-progress, resolved)
- Update practice configuration (carrier rules, exclusions, settings)
- View practice details

**What they must not access:**
- Other practices' data
- Queue build/run controls (automated)
- Platform-level admin functions

---

### Role 3: `billing_ops_manager`
**Display name:** Billing Ops Manager  
**Scope:** All practices (cross-practice visibility)  
**Current:** No — implement now, activate on expansion  

**Who they are:** A future HQ-level role. When CollectRx manages multiple dental practices, this person monitors the health of the entire portfolio — identifying which practices have aging AR problems, which carriers are underperforming across the board, and where escalation backlogs are forming. They are an operational supervisor, not a technical administrator.

**What they need:**
- Claims across all practices (read + pause/unpause)
- Escalations across all practices (view + resolve)
- Aging reports across all practices
- Carrier stats across all practices
- Queue stats across all practices
- List and view all practices (read-only)

**What they must not access:**
- Practice configuration updates (stays with owner + platform admin)
- Queue build/run controls
- Platform-level admin functions

---

### Role 4: `platform_admin`
**Display name:** Platform Admin  
**Scope:** All practices (system-level)  
**Current:** No — implement now, activate on expansion  

**Who they are:** The technical steward of the CollectRx platform. Responsible for onboarding new practices, managing configurations, and troubleshooting. **Critical privacy constraint:** Platform Admins cannot access individual claim or patient-level data at a practice unless the Practice Owner of that practice has explicitly granted access. This is a deliberate privacy-first design decision with Canadian health data compliance in mind (PIPEDA / provincial health privacy laws).

**What they need:**
- List and view all practices
- Update practice configuration for any practice
- Queue stats (monitoring)
- Break-glass access to `build_queue` and `run_queue` (emergency/maintenance only — should be logged)
- Claim-level access **only when explicitly granted by the Practice Owner of that practice**

**What they must not access by default:**
- Individual claims, escalations, or reports for any practice without per-practice owner approval
- No blanket cross-practice claim visibility

**Implementation note:** Model this as a `practice_access_grants` table — `(platform_admin_id, practice_id, granted_by, granted_at)`. A platform admin's effective claim permissions are the union of their role defaults + any practices where a grant record exists.

---

### Role 5: `auditor`
**Display name:** Auditor / Read-Only  
**Scope:** Configurable (single practice or all practices, set at grant time)  
**Current:** Yes  

**Who they are:** Accountants, investors, compliance reviewers, or external auditors. They need to assess the financial health of the practice(s) without any ability to modify data. Zero write access — this is non-negotiable.

**What they need:**
- Aging report
- Carrier stats
- Queue stats

**What they must not access:**
- Individual claims or patient-level data
- Escalations
- Practice configuration
- Queue controls
- Any write operations whatsoever

---

## 4. Access Control Matrix

Legend: ✅ Full Access · 👁 Read Only · 🏥 Own Practice Only · 🔐 With Explicit Grant · 🚨 Break-Glass Only · ❌ No Access

| Resource / Action | `front_desk` | `practice_owner` | `billing_ops_manager` | `platform_admin` | `auditor` |
|---|:---:|:---:|:---:|:---:|:---:|
| **PRACTICES** | | | | | |
| `list_practices` | ❌ | 🏥 | 👁 All | 👁 All | ❌ |
| `get_practice` | ❌ | 🏥 | 👁 All | 👁 All | ❌ |
| `update_practice` | ❌ | 🏥 | ❌ | ✅ All | ❌ |
| **CLAIMS** | | | | | |
| `list_claims` | 🏥 | 🏥 | 👁 All | 🔐 | ❌ |
| `get_claim` | 🏥 | 🏥 | 👁 All | 🔐 | ❌ |
| `pause_claim` | 🏥 | 🏥 | ✅ All | 🔐 | ❌ |
| `unpause_claim` | 🏥 | 🏥 | ✅ All | 🔐 | ❌ |
| **QUEUE** | | | | | |
| `build_queue` | ❌ | ❌ | ❌ | 🚨 | ❌ |
| `run_queue` | ❌ | ❌ | ❌ | 🚨 | ❌ |
| `get_queue_stats` | ❌ | 🏥 | ✅ All | ✅ All | ✅ (scoped) |
| **ESCALATIONS** | | | | | |
| `list_escalations` | 🏥 | 🏥 | ✅ All | 🔐 | ❌ |
| `resolve_escalation` | 🏥 | 🏥 | ✅ All | 🔐 | ❌ |
| **REPORTS** | | | | | |
| `get_aging_report` | ❌ | 🏥 | ✅ All | ✅ All | ✅ (scoped) |
| `get_carrier_stats` | ❌ | 🏥 | ✅ All | ✅ All | ✅ (scoped) |

---

## 5. Scope Rules

All data access must be filtered through a **practice scope** at the data layer — never at the UI layer only.

```
function canAccessPractice(user, practiceId):
  if user.role == 'front_desk':
    return user.assigned_practice_id == practiceId

  if user.role == 'practice_owner':
    return user.owned_practice_id == practiceId

  if user.role == 'billing_ops_manager':
    return true  // all practices

  if user.role == 'platform_admin':
    return true  // for config; for claims, check practice_access_grants

  if user.role == 'auditor':
    return user.granted_practice_ids.includes(practiceId)
    // or true if granted 'all_practices' at time of account creation
```

**For `platform_admin` claim access specifically:**
```
function platformAdminCanAccessClaims(adminId, practiceId):
  return practice_access_grants.exists(
    admin_id: adminId,
    practice_id: practiceId
  )
```

---

## 6. Data Model (Suggested)

```sql
-- Core roles enum
CREATE TYPE user_role AS ENUM (
  'front_desk',
  'practice_owner',
  'billing_ops_manager',
  'platform_admin',
  'auditor'
);

-- Users table
CREATE TABLE users (
  id              UUID PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  role            user_role NOT NULL,
  assigned_practice_id  UUID REFERENCES practices(id),
  -- assigned_practice_id is required for front_desk and practice_owner
  -- null for billing_ops_manager, platform_admin
  -- null for auditor (scope defined in auditor_practice_grants)
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Explicit per-practice grants for platform_admin claim access
CREATE TABLE platform_admin_practice_grants (
  id              UUID PRIMARY KEY,
  admin_id        UUID REFERENCES users(id),
  practice_id     UUID REFERENCES practices(id),
  granted_by      UUID REFERENCES users(id),  -- must be practice_owner of that practice
  granted_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(admin_id, practice_id)
);

-- Auditor practice scope grants
CREATE TABLE auditor_practice_grants (
  id              UUID PRIMARY KEY,
  auditor_id      UUID REFERENCES users(id),
  practice_id     UUID REFERENCES practices(id),
  -- or a special sentinel value / boolean 'all_practices'
  granted_by      UUID REFERENCES users(id),
  granted_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(auditor_id, practice_id)
);

-- Break-glass queue action audit log
CREATE TABLE queue_override_log (
  id              UUID PRIMARY KEY,
  admin_id        UUID REFERENCES users(id),
  action          TEXT NOT NULL,  -- 'build_queue' | 'run_queue'
  reason          TEXT,
  performed_at    TIMESTAMPTZ DEFAULT now()
);
```

---

## 7. Implementation Phases

### Phase 1 — Current (Single Practice) ✅ Build Now
- Implement `front_desk` and `practice_owner` roles
- All data scoped to a single practice — scope logic still present but trivially satisfied
- `auditor` role (read-only reports)
- Break-glass queue log table (even if unused, good to have)

### Phase 2 — Expansion (Multi-Practice)
- Activate `billing_ops_manager` role
- Activate `platform_admin` role with `platform_admin_practice_grants` enforcement
- Add `auditor_practice_grants` for cross-practice auditors
- Add practice-selection UI for `billing_ops_manager` reports

### Phase 3 — Compliance Hardening (Canadian Market)
- Audit trail for all write actions (who paused/resolved what, when)
- Data residency tagging per practice (province)
- PIPEDA-aligned data access request workflow
- Session-level logging for `platform_admin` claim access

---

## 8. Key Decisions to Validate with Stakeholder

Before implementation, confirm:

1. **Escalation routing** — Should `front_desk` and `practice_owner` see the *same* escalation queue, or separate views (e.g., owner sees all, front desk sees only unassigned)?
2. **Auditor scope at creation** — Is an auditor granted access to one practice, all current practices, or all practices including future ones?
3. **Platform admin grant flow** — Who initiates the access request — the admin, or the practice owner? What's the UX?
4. **Break-glass triggers** — Should `build_queue` / `run_queue` overrides require a written reason, and who gets notified (practice owner? all owners?)?

---

## 9. CollectRx MCP Tool Reference

For integration with the CollectRx MCP layer, all API calls should pass the authenticated user's role and practice scope. The MCP server should enforce scoping server-side — the client should never be trusted to filter results.

| MCP Tool | Method Type | Notes |
|---|---|---|
| `list_practices` | Read | Filter by scope |
| `get_practice` | Read | Check ownership |
| `update_practice` | Write | `practice_owner` own + `platform_admin` all |
| `list_claims` | Read | Scope to practice(s) |
| `get_claim` | Read | Scope to practice(s) |
| `pause_claim` | Write | Log action + actor |
| `unpause_claim` | Write | Log action + actor |
| `build_queue` | System | Admin break-glass only — log to `queue_override_log` |
| `run_queue` | System | Admin break-glass only — log to `queue_override_log` |
| `get_queue_stats` | Read | Scope to practice(s) |
| `list_escalations` | Read | Scope to practice(s) |
| `resolve_escalation` | Write | Log action + actor |
| `get_aging_report` | Read | Scope to practice(s) |
| `get_carrier_stats` | Read | Scope to practice(s) |

---

*End of handoff. Questions → Khalid Egeh (khalidegeh97@gmail.com)*
