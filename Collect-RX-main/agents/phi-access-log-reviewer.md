# CollectRx PHI Access Log Reviewer Agent

**Purpose:** Review the PHI access audit log for anomalies. Under PHIPA, every access to patient health information must be logged and periodically reviewed. This agent does that review and flags anything that looks wrong. Run monthly, or immediately after any security incident.

---

## Context

CollectRx logs PHI access events via `appendPhiAccessEvent()` (`src/server/audit/auditLog.ts`) into the `PhiAccessEvent` Prisma model (`phi_access_events` table). Each row has `operation` (a specific string like `detokenize_for_carrier_call`, not a fixed enum), `recordType`/`recordId` (e.g. `InsuranceClaim` + claim id), `actorId`, `practiceId`, `purpose`, and `correlationId`.

**Current reality (verify against `src/server` before each run — this drifts):** every existing call site logs a `detokenize_*` operation (carrier-call dispatch, pre-visit dispatch/portal checks, TELUS Tx23, priority-queue display, manual carrier trigger). **There is no `view` or `export` PHI-access logging implemented today** — staff opening a claim detail screen or exporting a CSV/PDF containing patient data does not currently write a `PhiAccessEvent` row. Treat the "Volume Anomalies" and "Platform Admin Without Grant" checks below as aspirational until that logging exists; today they will just return zero rows, which is a coverage gap, not a clean bill of health. Flag this gap explicitly in the monthly report rather than reporting "no `view`/`export` anomalies found."

Access to this log is the PHIPA audit trail. If CollectRx is ever investigated, this log is what you produce — so the `view`/`export` gap above is itself worth escalating.

---

## Anomaly Detection Checklist

### Volume Anomalies

- [ ] Total `detokenize` events in the last 30 days. Does it match the number of completed calls? If `detokenize` count >> completed calls, something is re-detokenizing when it shouldn't.
- [ ] Any single `performedBy` userId with >100 `view` events in a single day. This is a data exfiltration pattern.
- [ ] `export` events. Each should correspond to a deliberate staff action. Flag any export that is not preceded by a corresponding user session within 5 minutes.

### Access Outside Business Hours

Query for PHI access events between 10pm and 7am Eastern or on weekends:

```sql
SELECT * FROM phi_access_events
WHERE EXTRACT(DOW FROM created_at AT TIME ZONE 'America/Toronto') IN (0, 6)
   OR EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Toronto') NOT BETWEEN 7 AND 22
ORDER BY created_at DESC;
```

Flag any non-system access outside these hours. System detokenizations (after overnight calls) are expected; a staff `view` or `export` at 3am would not be — but see the note above, that access type isn't logged yet, so today this query only ever surfaces detokenize events.

### Platform Admin Without Grant

The access control rule: `platform_admin` cannot view claim-level PHI for a practice without a `platformAdminGrant` record. Query:

```sql
SELECT pae.*
FROM phi_access_events pae
JOIN users u ON u.id = pae.actor_id
WHERE u.role = 'platform_admin'
  AND NOT EXISTS (
    SELECT 1 FROM platform_admin_practice_grants pag
    WHERE pag.admin_user_id = pae.actor_id
      AND pag.practice_id = pae.practice_id
  );
```

(Dropped the `action IN ('view', 'export')` filter — those operations aren't logged yet, see the note above. Until they are, this query checks whether a `platform_admin` has any `detokenize_*` event on a practice they lack a grant for, which is still a real violation worth catching.)

Any result here is an access control violation. Flag immediately.

### Detokenize Without a Following Call

Detokenization happens server-side at dispatch time, *before* the carrier call is placed (PHI-VAPI-BOUNDARY.md Option B) — not after completion. So every `detokenize_*` event should have a corresponding `call_attempts` row `initiated_at` shortly *after* it, not a completed call within the same minute:

```sql
SELECT pae.*
FROM phi_access_events pae
WHERE pae.operation LIKE 'detokenize_%'
  AND pae.record_type = 'InsuranceClaim'
  AND NOT EXISTS (
    SELECT 1 FROM call_attempts ca
    WHERE ca.claim_id = pae.record_id
      AND ca.initiated_at BETWEEN pae.created_at
                               AND pae.created_at + INTERVAL '5 minutes'
  );
```

Orphaned detokenize events (no matching subsequent call) indicate a bug in the detokenization path — PHI was resolved without a call ever being placed.

### Missing Log Entries

Estimate: every `call_attempts` row should have exactly one preceding `detokenize_*` log entry. Query:

```sql
SELECT ca.id, ca.claim_id
FROM call_attempts ca
WHERE NOT EXISTS (
    SELECT 1 FROM phi_access_events pae
    WHERE pae.record_type = 'InsuranceClaim'
      AND pae.record_id = ca.claim_id
      AND pae.operation LIKE 'detokenize_%'
      AND pae.created_at BETWEEN ca.initiated_at - INTERVAL '5 minutes'
                              AND ca.initiated_at
  );
```

Missing entries = `appendPhiAccessEvent()` is not being called at all detokenization points. Flag the missing call sites — this is exactly the class of bug AA-01 found and fixed for 3 of the 6 real call sites; re-run this check after any new dispatch path is added.

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
"Run the CollectRx PHI Access Log review for the last 30 days. Query the phi_access_events table. Run all anomaly queries in agents/phi-access-log-reviewer.md. Flag any access control violations immediately, and flag the missing view/export logging coverage gap. Produce the monthly report."
```
