# CollectRx PHI Access Log Reviewer Agent

**Purpose:** Review the PHI access audit log for anomalies. Under PHIPA, every access to patient health information must be logged and periodically reviewed. This agent does that review and flags anything that looks wrong. Run monthly, or immediately after any security incident.

---

## Context

CollectRx logs every PHI access event via `phiAuditService.log()`. The log lives in the `phiAccessLog` map (in-memory, current implementation) or the `PhiAccessLog` Prisma table (if migrated to DB). Three access types are logged:

- `detokenize` — backend maps UUID → patient identifiers after a call completes
- `view` — staff opens a claim detail screen that shows patient identifiers
- `export` — any CSV or PDF export containing patient data

Access to this log is the PHIPA audit trail. If CollectRx is ever investigated, this log is what you produce.

---

## Anomaly Detection Checklist

### Volume Anomalies

- [ ] Total `detokenize` events in the last 30 days. Does it match the number of completed calls? If `detokenize` count >> completed calls, something is re-detokenizing when it shouldn't.
- [ ] Any single `performedBy` userId with >100 `view` events in a single day. This is a data exfiltration pattern.
- [ ] `export` events. Each should correspond to a deliberate staff action. Flag any export that is not preceded by a corresponding user session within 5 minutes.

### Access Outside Business Hours

Query for PHI access events between 10pm and 7am Eastern or on weekends:

```sql
SELECT * FROM phi_access_log
WHERE EXTRACT(DOW FROM performedAt AT TIME ZONE 'America/Toronto') IN (0, 6)
   OR EXTRACT(HOUR FROM performedAt AT TIME ZONE 'America/Toronto') NOT BETWEEN 7 AND 22
ORDER BY performedAt DESC;
```

Flag any non-`system` access outside these hours. System detokenizations (after overnight calls) are expected; staff `view` or `export` at 3am is not.

### Platform Admin Without Grant

The access control rule: `platform_admin` cannot view claim-level PHI for a practice without a `platformAdminGrant` record. Query:

```sql
SELECT pal.* 
FROM phi_access_log pal
JOIN users u ON u.id = pal.performedBy
WHERE u.role = 'platform_admin'
  AND pal.action IN ('view', 'export')
  AND NOT EXISTS (
    SELECT 1 FROM platform_admin_grants pag
    WHERE pag.adminId = pal.performedBy
      AND pag.practiceId = pal.practiceId
  );
```

Any result here is an access control violation. Flag immediately.

### Detokenize Without Completed Call

Every `detokenize` event should have a corresponding `callAttempt` with `completedAt` set within the same minute:

```sql
SELECT pal.*
FROM phi_access_log pal
WHERE pal.action = 'detokenize'
  AND NOT EXISTS (
    SELECT 1 FROM call_attempts ca
    WHERE ca.claimId = pal.claimId
      AND ca.completedAt BETWEEN pal.performedAt - INTERVAL '2 minutes'
                              AND pal.performedAt + INTERVAL '2 minutes'
  );
```

Orphaned detokenize events (no matching call) indicate a bug in the detokenization path — PHI was accessed without a legitimate trigger.

### Missing Log Entries

Estimate: every completed `callAttempt` should have exactly one `detokenize` log entry. Query:

```sql
SELECT ca.id, ca.claimId
FROM call_attempts ca
WHERE ca.completedAt IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM phi_access_log pal
    WHERE pal.claimId = ca.claimId
      AND pal.action = 'detokenize'
      AND pal.performedAt BETWEEN ca.completedAt - INTERVAL '5 minutes'
                               AND ca.completedAt + INTERVAL '5 minutes'
  );
```

Missing entries = `phiAuditService.log()` is not being called at all detokenization points. Flag the missing call sites.

---

## Breach Assessment Protocol

If any of the following are found, treat it as a potential PHIPA breach requiring notification assessment:

- PHI accessed by an unauthorized user (platform_admin without grant, wrong practice scope)
- PHI exported to an unknown destination
- Bulk access pattern (>500 `view` events for one user in one day)
- PHI appearing in application logs (`observability/logger.ts` redaction check)

**PHIPA breach notification requirement:** If a breach creates "real risk of significant harm" to the individual, the practice (as the health information custodian) must notify:
1. Affected patients (promptly)
2. Ontario IPC (Information and Privacy Commissioner) — written report

CollectRx as the agent of the practice is responsible for reporting the breach to the practice immediately. The practice handles IPC notification.

---

## Monthly Report Format

```
## PHI Access Log Review — [MONTH YEAR]

### Access Summary
- Total events: [n] (detokenize: [n], view: [n], export: [n])
- Unique users who accessed PHI: [n]
- After-hours access events: [n]

### Anomalies Found
- [Severity] [Description] — [Count] events, [Date range]

### Access Control Violations
- [None / list of violations]

### Breach Assessment
- [No breach indicators / Description of concerning pattern]

### Log Integrity
- Completed calls without detokenize log: [n] (should be 0)
- Orphaned detokenize events: [n] (should be 0)
```

---

## How to Run This Agent

```
"Run the CollectRx PHI Access Log review for the last 30 days. Query the phiAccessLog table (or in-memory equivalent). Run all anomaly queries in agents/phi-access-log-reviewer.md. Flag any access control violations immediately. Produce the monthly report."
```
