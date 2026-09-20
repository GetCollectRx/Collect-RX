// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Compliance Audit API
//
// GET /api/compliance/audit
//   Runs the full PHIPA / PIPEDA / Quebec Law 25 / Alberta HIA / AIDA audit.
//   Restricted to platform_admin and auditor roles.
//   Returns the structured ComplianceReport.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { runComplianceAudit } from '../compliance/auditAgent.js';
import { logger } from '../observability/logger.js';

export const complianceRouter = Router();

complianceRouter.get('/audit', authenticate, async (req, res) => {
  const auth = req.auth;
  const role = auth && 'role' in auth ? (auth as { role: string }).role : null;

  if (role !== 'platform_admin' && role !== 'auditor' && role !== 'platform_dev') {
    res.status(403).json({ error: 'Compliance audit requires platform_admin or auditor role.' });
    return;
  }

  try {
    const report = await runComplianceAudit();
    res.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[compliance] audit failed', { error: message });
    res.status(500).json({ error: 'Compliance audit failed', detail: message });
  }
});
