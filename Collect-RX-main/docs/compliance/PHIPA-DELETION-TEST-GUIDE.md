# PHIPA Compliance Integration Tests — User Guide

> **Current status (2026-08-05): this is a design spec, not a description of a shipped feature.** `PHIPADeletionRequest`/`PHIPABreachNotification` exist as Prisma models with no route, admin UI, or cron job anywhere in `src/`. `tests/phipaCompliance.test.ts` does not exercise those models — it defines a local mock `interface PHIPADeletionRequest` and simulates the workflow with direct `deleteMany()` calls. Until the "Implementation Guide for Cron Job" section below is actually built (which needs the legal/privacy sign-off described in [`docs/operations/HUMAN-DECISIONS-PENDING.md`](../operations/HUMAN-DECISIONS-PENDING.md) item 2 first), PHIPA deletion and breach-notification requests are handled by the manual process in [`PHIPA-MANUAL-PROCESS-RUNBOOK.md`](PHIPA-MANUAL-PROCESS-RUNBOOK.md), not by anything described in this file.

## Overview

The PHIPA compliance test suite (`tests/phipaCompliance.test.ts`) validates end-to-end deletion request workflows required by the **Personal Health Information Protection Act (PHIPA)**, Ontario Regulation 711/91.

### Compliance Scope

These tests verify:
1. **PHIPA s.37–39** — Patient access and deletion rights
2. **PHIPA s.65–68** — Breach notification with 14-day deadline
3. **Audit trail integrity** — Immutable logging of all data processing
4. **Data purge completeness** — All patient data types are removed

---

## Test Structure

### Test Suite: `PHIPA Compliance — Deletion Request Workflow`

#### 1. **Deletion Request Creation (PENDING status)**
```typescript
it('creates a deletion request with PENDING status', ...)
```

**What it tests:**
- Deletion request is created with `status: PENDING`
- Request timestamp (`requestedAt`) is recorded
- No completion timestamp exists initially
- Associated patient data is intact before deletion

**Why it matters:**
- Establishes audit trail start point
- Ensures request is queued for processing
- Provides evidence of timely response to patient request

---

#### 2. **Data Purge During Cron Execution**
```typescript
it('purges all patient data when cron job processes deletion request', ...)
```

**What it tests:**
- Claims with matching `patientToken` are deleted
- Call attempts (transcripts, audio) are deleted
- Eligibility snapshots are removed
- PHI vault entries are purged
- Audit logs document the deletion

**Purged data types:**
- `InsuranceClaim` — billing/clinical records
- `CallAttempt` — voice agent recordings and transcripts
- `CallTranscriptLine` — real-time transcript lines
- `EligibilitySnapshot` — benefits verification data
- `PhiVaultEntry` — encrypted PHI backing store

**Why it matters:**
- Demonstrates compliance with deletion rights
- Shows no data residue remains
- Provides audit evidence for regulators

---

#### 3. **Breach Notification with 14-Day Deadline**
```typescript
it('logs breach notification with 14-day compliance deadline', ...)
```

**What it tests:**
- Breach is detected and logged
- Notification deadline is 14 days from discovery
- Breach type is classified (DATA_EXPOSURE, UNAUTHORIZED_ACCESS, etc.)
- Affected patient token is recorded

**Why it matters:**
- PHIPA s.65(1) requires notification within reasonable time (~14 days)
- Demonstrates compliance tracking for potential data exposure
- Provides evidence of incident response procedures

---

#### 4. **Audit Trail Integrity Throughout Lifecycle**
```typescript
it('maintains audit trail integrity throughout deletion lifecycle', ...)
```

**What it tests:**
- Audit logs document: creation → deletion request → execution → completion
- Logs are immutable (not updated or deleted)
- Deletion details (counts, timestamps) are recorded
- Sequence of actions is chronologically ordered

**Audit log sequence:**
```
claim_created
→ call_attempt_recorded
→ phipa_deletion_requested
→ phipa_deletion_executed
```

**Why it matters:**
- Proves compliance to regulators
- Enables forensic investigation if breach occurs
- Demonstrates accountability and transparency

---

#### 5. **Partial Failure and Retry Handling**
```typescript
it('handles partial failure and retry on deletion job failure', ...)
```

**What it tests:**
- Failed deletion attempt is logged
- Retry mechanism logs separate attempts
- Completion eventually succeeds
- Total attempt count is tracked

**Logged sequence:**
```
phipa_deletion_attempt_1
→ phipa_deletion_attempt_1_failed
→ phipa_deletion_completed
```

**Why it matters:**
- Shows resilience and reliability
- Documents troubleshooting for support
- Prevents silent failures

---

#### 6. **Comprehensive Data Type Purge Validation**
```typescript
it('validates that all patient data types are purged', ...)
```

**What it tests:**
- Every data type tied to `patientToken` is removed
- Counts verify zero residual data
- All related records (claims, calls, recovery actions, transcripts) are gone

**Data types verified:**
- InsuranceClaim
- CallAttempt
- CallTranscriptLine
- EligibilitySnapshot
- ClaimRecoveryAction
- PhiVaultEntry

**Why it matters:**
- Ensures no hidden patient data remains
- Validates database referential integrity
- Proves complete erasure per PHIPA s.39

---

#### 7. **Audit Log Immutability**
```typescript
it('enforces audit log immutability during deletion', ...)
```

**What it tests:**
- Audit log entries cannot be updated after creation
- Records persist even when subject data is deleted
- Logs remain queryable for compliance verification

**Why it matters:**
- Prevents tampering or cover-ups
- Provides reliable evidence trail
- Satisfies regulatory audit requirements

---

## Running the Tests

### Prerequisites

```bash
# Install dependencies
npm ci

# Ensure DATABASE_URL is set (test requires active PostgreSQL)
echo "DATABASE_URL=postgresql://user:pass@localhost:5432/collectrx_test" >> .env.test.local
```

### Run All PHIPA Tests

```bash
npm test -- tests/phipaCompliance.test.ts
```

### Run a Specific Test

```bash
npm test -- tests/phipaCompliance.test.ts -t "purges all patient data"
```

### Run with Verbose Output

```bash
npm test -- tests/phipaCompliance.test.ts --reporter=verbose
```

### Skip if Database Unavailable

Tests automatically skip if `DATABASE_URL` is unreachable. To force run:

```bash
DATABASE_URL=postgresql://localhost/test npm test tests/phipaCompliance.test.ts
```

---

## Test Data Model

### PHIPADeletionRequest

```typescript
interface PHIPADeletionRequest {
  id: string;                    // UUID
  practiceId: string;            // FK to Practice
  patientToken: string;          // UUID (not real patient identifier)
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  requestedAt: Date;             // Timestamp of deletion request
  completedAt?: Date;            // When deletion finished
  failureReason?: string;        // If status === FAILED
  purgedClaimsCount: number;     // Records deleted
  purgedCallsCount: number;
  purgedRecordingsCount: number;
}
```

### PHIPABreachNotification

```typescript
interface BreachNotification {
  id: string;                       // UUID
  practiceId: string;               // FK to Practice
  notificationType: string;         // DELETION_BREACH | DATA_EXPOSURE | ...
  description: string;              // Details of breach
  notificationDeadline: Date;       // 14 days from discovery
  notifiedAt?: Date;                // When practice was notified
  affectedPatientToken?: string;    // Affected patient (if known)
}
```

### Audit Log Entry (PHIPA-relevant)

```typescript
interface AuditLogPHIPA {
  id: string;
  practiceId: string;
  action: string; // phipa_deletion_requested | phipa_deletion_completed | phipa_breach_notification_logged
  subjectType: string; // patient_token | deletion_request | breach
  subjectId: string;
  details: {
    // Action-specific metadata
    requestId?: string;
    patientToken?: string;
    purgedClaimsCount?: number;
    notificationDeadline?: string;
    [key: string]: unknown;
  };
  createdAt: Date;
}
```

---

## Database Schema

### Migration File

New tables are added via migration:
```
prisma/migrations/20260710210000_phipa_deletion_and_breach/migration.sql
```

### Prisma Models

```prisma
model PHIPADeletionRequest {
  id                   String
  practiceId           String
  patientToken         String
  status               String      // PENDING | IN_PROGRESS | COMPLETED | FAILED
  requestedAt          DateTime
  completedAt          DateTime?
  failureReason        String?
  purgedClaimsCount    Int
  purgedCallsCount     Int
  purgedRecordingsCount Int
  createdAt            DateTime
  updatedAt            DateTime
  
  practice Practice @relation(...)
  
  @@index([practiceId])
  @@index([patientToken])
  @@index([status])
  @@map("phipa_deletion_requests")
}

model PHIPABreachNotification {
  id                   String
  practiceId           String
  notificationType     String
  description          String
  notificationDeadline DateTime
  notifiedAt           DateTime?
  affectedPatientToken String?
  affectedRecordsCount Int
  remediationSteps     String?
  remediationCompleted DateTime?
  createdAt            DateTime
  
  practice Practice @relation(...)
  
  @@index([practiceId])
  @@index([notificationDeadline])
  @@map("phipa_breach_notifications")
}
```

---

## Implementation Guide for Cron Job

To make these tests pass in production, implement a cron job that:

### 1. Query Pending Deletion Requests

```typescript
const pending = await prisma.phipaDeletionRequest.findMany({
  where: { status: 'PENDING' },
  orderBy: { requestedAt: 'asc' },
  take: 10, // Batch process
});
```

### 2. For Each Request:

```typescript
for (const req of pending) {
  try {
    // Mark as in-progress
    await prisma.phipaDeletionRequest.update({
      where: { id: req.id },
      data: { status: 'IN_PROGRESS' },
    });

    // Log start
    await prisma.auditLog.create({
      data: {
        practiceId: req.practiceId,
        action: 'phipa_deletion_started',
        details: { deletionRequestId: req.id },
      },
    });

    // Purge all patient data by patientToken
    const claimsDeleted = await prisma.insuranceClaim.deleteMany({
      where: {
        practiceId: req.practiceId,
        patientToken: req.patientToken,
      },
    });

    const callsDeleted = await prisma.callAttempt.deleteMany({
      where: {
        claim: {
          practiceId: req.practiceId,
          patientToken: req.patientToken,
        },
      },
    });

    await prisma.phiVaultEntry.deleteMany({
      where: { token: req.patientToken },
    });

    // Mark completed
    await prisma.phipaDeletionRequest.update({
      where: { id: req.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        purgedClaimsCount: claimsDeleted.count,
        purgedCallsCount: callsDeleted.count,
      },
    });

    // Log completion
    await prisma.auditLog.create({
      data: {
        practiceId: req.practiceId,
        action: 'phipa_deletion_completed',
        details: {
          deletionRequestId: req.id,
          purgedClaimsCount: claimsDeleted.count,
          purgedCallsCount: callsDeleted.count,
        },
      },
    });
  } catch (error) {
    // Mark as failed
    await prisma.phipaDeletionRequest.update({
      where: { id: req.id },
      data: {
        status: 'FAILED',
        failureReason: (error as Error).message,
      },
    });
  }
}
```

---

## Compliance Checklist

Before deploying to production, verify:

- [ ] All tests pass: `npm test tests/phipaCompliance.test.ts`
- [ ] Audit logs are immutable (app prevents updates)
- [ ] Cron job is scheduled (e.g., daily at 2 AM Eastern)
- [ ] 14-day notification deadline is enforced
- [ ] PHI vault cleanup respects TTL
- [ ] Database backups exclude deleted patient data post-purge
- [ ] Legal team reviews deletion workflow
- [ ] Privacy Officer approves audit trail retention policy
- [ ] Disaster recovery procedure tested (restore from backup, verify deleted data does not return)

---

## Regulatory References

- **PHIPA s.37–39** — Patient access and deletion rights
- **PHIPA s.65–68** — Breach notification and reporting
- **PIPEDA Principle 4.3.4.1** — Minimal retention
- **OPC Guidance** — Personal Health Information Protection Act, 1991 (PHIPA) — Deletion of Personal Health Information

---

## Troubleshooting

### Test Skipped: "DATABASE_URL unreachable"
- Verify PostgreSQL is running
- Check `.env` or `.env.test.local` has valid `DATABASE_URL`
- Run `psql $DATABASE_URL -c "SELECT 1"` to test connection

### Assertion Failed: "claimsAfter > 0"
- Ensure claim was created before purge
- Verify `patientToken` matches between claim and purge query
- Check if claim was already deleted by another test

### Audit Log Missing Action
- Verify `auditLog.create()` succeeded
- Check `practiceId` matches deletion request
- Ensure `action` string matches expected value

### Timeout on 30000 ms
- Slow database? Increase timeout: `.test(..., ...)` → `.test(..., ..., 60000)`
- Check database indexes are created
- Review slow query logs

---

## See Also

- [PHI-VAPI-BOUNDARY.md](./PHI-VAPI-BOUNDARY.md) — Patient data tokenization
- [CRTC-DISCLOSURE-DECISION.md](./CRTC-DISCLOSURE-DECISION.md) — Call disclosure compliance
- [AUDIT-LOG-RETENTION.md](./AUDIT-LOG-RETENTION.md) — Log retention policy
