# CollectRx Database Health Agent

**Purpose:** Monitor Railway PostgreSQL for migration drift, orphaned records, data integrity issues, and capacity concerns. Run weekly. A database problem that isn't caught early will corrupt claim state or lose PHI audit trail data.

---

## Context

CollectRx uses Prisma ORM with PostgreSQL on Railway. Migrations run via `prisma migrate deploy` at deploy time. The PHI encryption key (`PHI_ENCRYPTION_KEY`) is required at startup.

Key tables and their importance:
- `insuranceClaim` — the core business entity; data corruption here = lost revenue
- `callAttempt` — call history; must be complete for PHIPA audit and carrier stats
- `phiAccessLog` — PHIPA audit trail; must be append-only and complete
- `practiceDesksState` — queue pause state; corruption causes stuck queues
- `callQueue` — active queue; orphaned entries cause infinite retries

---

## Migration Health

```bash
npx prisma migrate status
```

- [ ] All migrations are applied — no "pending" state in production
- [ ] No drift between schema.prisma and the actual DB schema (`prisma migrate diff`)
- [ ] The `eligibility-schema.sql` migration was run directly against Railway (not via Prisma migration) — confirm these tables exist: `eligibility_snapshots`, `eligibility_estimates`, `estimate_procedures`, `deductible_tracking`, `annual_max_tracking`, `reconciliation_logs`

### Migration Safety Check

Before any new migration is deployed:
- [ ] Is the migration reversible? (DROP COLUMN, DROP TABLE are not)
- [ ] Does it lock tables? (Adding a NOT NULL column to a large table causes lock)
- [ ] Is there a rollback plan?
- [ ] Was it tested against a staging DB first?

---

## Data Integrity Checks

### Orphaned Queue Entries

```sql
SELECT cq.* FROM call_queue cq
LEFT JOIN insurance_claim ic ON ic.id = cq.claimId
WHERE ic.id IS NULL;
```

Any result = queue entry with no matching claim. These will cause errors on every tick. Delete them.

### Claims With No Practice

```sql
SELECT ic.id, ic.practiceId FROM insurance_claim ic
LEFT JOIN practices p ON p.id = ic.practiceId
WHERE p.id IS NULL;
```

Any result = orphaned claim data. Should not exist.

### Completed Calls With No Outcome

```sql
SELECT ca.id, ca.claimId, ca.completedAt FROM call_attempts ca
WHERE ca.completedAt IS NOT NULL AND ca.outcome IS NULL;
```

Any result = `classifyOutcome()` failed to write or was skipped. These claims are stuck. Manually review and classify.

### Claims Still In Queue After 90 Days

```sql
SELECT ic.id, ic.claimRef, ic.carrierId, ic.createdAt,
       DATE_PART('day', NOW() - ic.createdAt) AS days_old
FROM insurance_claim ic
JOIN call_queue cq ON cq.claimId = ic.id
WHERE DATE_PART('day', NOW() - ic.createdAt) > 90;
```

Any result = the 90-day auto-escalation rule failed. These should have been moved to escalation. Flag and manually escalate.

### PHI Access Log Completeness

```sql
SELECT COUNT(*) as completed_calls,
       (SELECT COUNT(*) FROM phi_access_log WHERE action = 'detokenize') as detokenize_events
FROM call_attempts WHERE completedAt IS NOT NULL;
```

These counts should be equal. A gap = `phiAuditService.log()` is not being called consistently.

### Duplicate Claims

```sql
SELECT claimRef, practiceId, COUNT(*) as n
FROM insurance_claim
GROUP BY claimRef, practiceId
HAVING COUNT(*) > 1;
```

Any result = CSV import idempotency failed for these records. Investigate.

---

## Capacity Monitoring

### Table Row Counts

```sql
SELECT 
  relname AS table,
  n_live_tup AS live_rows
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
```

Flag if any table is growing unexpectedly fast. `phi_access_log` and `call_attempts` will grow with usage — that's expected. `call_queue` should not accumulate indefinitely (entries should clear as calls complete).

### PHI Encryption Key

- [ ] `PHI_ENCRYPTION_KEY` is set in Railway environment
- [ ] The encrypted PHI fields decrypt successfully (test with a known claim that has encrypted data)
- [ ] The encryption key version in stored payloads matches the current key (supports rotation — check for stale version markers)

---

## Backup Status

Railway provides automated backups for PostgreSQL. Verify:
- [ ] Backup schedule is configured (daily minimum)
- [ ] Last backup timestamp is within 24 hours
- [ ] A restore test has been performed in the last 90 days (restore to staging, verify data)

The restore test is documented in the ops runbook (`docs/operations/PHASE6-OPS.md`). Confirm it was actually run, not just documented.

---

## Slow Query Check

```sql
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100  -- ms
ORDER BY total_exec_time DESC
LIMIT 10;
```

Any query averaging >500ms is a concern. The most likely slow queries:
- Claims table scan without index on `practiceId + status`
- PHI access log without index on `performedAt`
- Queue tick query without covering index on `practiceId + status + scheduledFor`

---

## Report Format

```
## Database Health — [DATE]

### Migration Status
- [All applied / N pending]
- [Eligibility schema tables: present / missing]

### Data Integrity
- Orphaned queue entries: [n] (should be 0)
- Completed calls with no outcome: [n] (should be 0)
- Claims >90d still in queue: [n] (should be 0)
- PHI log completeness: [detokenize events vs completed calls]
- Duplicate claims: [n claim refs affected]

### Capacity
- Largest tables: [name, row count]
- Unexpected growth: [any flags]

### Backup
- Last backup: [timestamp]
- Last restore test: [date]

### Performance
- Slow queries (>500ms): [list or "none"]
```

---

## How to Run This Agent

```
"Run the CollectRx database health check against the Railway PostgreSQL instance. Run the integrity SQL queries in agents/database-health.md. Check migration status with prisma migrate status. Flag any orphaned records, PHI log gaps, or >90d claims in queue. Produce the health report."
```
