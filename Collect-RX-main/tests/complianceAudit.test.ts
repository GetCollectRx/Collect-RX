// ─────────────────────────────────────────────────────────────────────────────
// CollectRx Compliance Audit — Unit Tests
//
// Verifies that the audit agent produces expected results for the live codebase.
// All checks are static/structural — no DB, no network, no PHI touched.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { runComplianceAudit } from '../src/server/compliance/auditAgent.js';
import type { ComplianceReport } from '../src/server/compliance/types.js';

describe('CollectRx Compliance Audit Agent', () => {
  let report: ComplianceReport;

  it('generates a compliance report without throwing', async () => {
    report = await runComplianceAudit();
    expect(report).toBeDefined();
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it('produces a score between 0 and 100', async () => {
    const r = await runComplianceAudit();
    expect(r.summary.score).toBeGreaterThanOrEqual(0);
    expect(r.summary.score).toBeLessThanOrEqual(100);
  });

  it('check counts sum to total', async () => {
    const r = await runComplianceAudit();
    const { total, pass, warn, fail, info } = r.summary;
    expect(pass + warn + fail + info).toBe(total);
  });

  it('covers all 10 compliance domains', async () => {
    const r = await runComplianceAudit();
    const domains = Object.keys(r.domains);
    const expected = [
      'PHI_BOUNDARY', 'ENCRYPTION', 'ACCESS_CONTROL', 'AUDIT_TRAIL',
      'RATE_LIMITING', 'DATA_RESIDENCY', 'RETENTION', 'DISCLOSURE',
      'INPUT_VALIDATION', 'SESSION_SECURITY',
    ];
    for (const d of expected) {
      expect(domains).toContain(d);
    }
  });

  it('PHI boundary: PII vault tokenization passes (A1)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'A1');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('PHI boundary: detokenization server-side check present (A2)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'A2');
    expect(check).toBeDefined();
    expect(['pass', 'warn']).toContain(check!.status);
  });

  it('PHI boundary: token TTL configured (A3)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'A3');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('PHI boundary: zero-retention audio policy passes (A5)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'A5');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('PHI boundary: platform_dev PHI redaction passes (A6)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'A6');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Encryption: AES-256-GCM at rest passes (B1)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'B1');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Encryption: random IV per call passes (B2)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'B2');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Encryption: crypto audit logging passes (B3)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'B3');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Encryption: GCM auth tag verified on decrypt (B6)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'B6');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Access Control: RBAC matrix covers all roles (C1)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'C1');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Access Control: PHI routes gated by role (C2)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'C2');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Access Control: httpOnly cookie + JWT auth (C3)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'C3');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Access Control: accountant token expiry fail-closed (C4)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'C4');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Audit Trail: append-only audit log passes (D1)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'D1');
    expect(check).toBeDefined();
    expect(['pass', 'warn']).toContain(check!.status);
  });

  it('Audit Trail: PHI_CRYPTO_ACCESS events passes (D4)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'D4');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Rate Limiting: auth limiter 5/15min passes (E1)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'E1');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Data Residency: Canada-Central headers pass (F1)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'F1');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Session Security: JWT startup assertion passes (J1)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'J1');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Session Security: Vapi phone allowlist passes (J5)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'J5');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Input Validation: helmet middleware passes (I3)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'I3');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
  });

  it('Input Validation: CORS configured (I4)', async () => {
    const r = await runComplianceAudit();
    const check = r.checks.find((c) => c.id === 'I4');
    expect(check).toBeDefined();
    expect(['pass', 'warn']).toContain(check!.status);
  });

  it('critical findings are all checks with status=fail', async () => {
    const r = await runComplianceAudit();
    const failing = r.checks.filter((c) => c.status === 'fail');
    expect(r.criticalFindings).toEqual(failing);
  });

  it('no check has an empty evidence string', async () => {
    const r = await runComplianceAudit();
    for (const c of r.checks) {
      expect(c.evidence.length).toBeGreaterThan(0);
    }
  });

  it('no check has an empty title', async () => {
    const r = await runComplianceAudit();
    for (const c of r.checks) {
      expect(c.title.length).toBeGreaterThan(0);
    }
  });

  it('each check id is unique', async () => {
    const r = await runComplianceAudit();
    const ids = r.checks.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('overall compliance score meets baseline expectation (≥ 70)', async () => {
    const r = await runComplianceAudit();
    // This threshold documents the minimum acceptable posture.
    // A score below 70 means ≥30% of controls are failing — investigate immediately.
    expect(r.summary.score).toBeGreaterThanOrEqual(70);
  });
});
