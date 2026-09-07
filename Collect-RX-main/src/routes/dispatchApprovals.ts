// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Dispatch approvals API.
//
// Human-in-the-loop checkpoint before a claim's first outbound Vapi call.
// GET  /api/dispatch-approvals         — claims currently PENDING_REVIEW
// POST /api/dispatch-approvals/decide  — approve/skip a batch, immutably logged
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../server/middleware/requirePracticeSession';
import { useOwnerPracticeApi } from '../server/middleware/ownerPracticeApi.js';
import { requireClaimScope } from '../server/middleware/requireClaimScope.js';
import { apiErrorMessageForResponse } from '../server/apiErrorMessage.js';
import { authUserId, isPlatformDev } from '../server/accessControl/types.js';
import { maskClaimNumber } from '../server/accessControl/redaction.js';
import { appendAuditLog } from '../server/audit/auditLog.js';
import {
  listPendingDispatchApprovals,
  decideDispatchApprovalBatch,
  type DispatchDecisionInput,
} from '../server/services/dispatchApprovalService.js';

const router = Router();
useOwnerPracticeApi(router);

router.get('/', requireClaimScope('list_dispatch_approvals'), async (req: Request, res: Response) => {
  try {
    const qP = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
    if (queryPracticeConflictsSession(req, qP || undefined)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const items = await listPendingDispatchApprovals(prisma, practiceId);
    const auth = req.auth ?? req.practiceAuth;
    const data = isPlatformDev(auth)
      ? items.map((i) => ({ ...i, patientName: '[redacted]', claimNumber: maskClaimNumber(i.claimNumber) }))
      : items;
    void appendAuditLog(prisma, {
      practiceId,
      action: 'phi.view',
      subjectType: 'dispatch_approvals',
      subjectId: practiceId,
      details: { claimCount: items.length },
      req,
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /dispatch-approvals]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/decide', requireClaimScope('decide_dispatch_approval'), async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const body = req.body as { decisions?: unknown };
    if (!Array.isArray(body.decisions) || body.decisions.length === 0) {
      return res.status(400).json({ success: false, error: 'decisions must be a non-empty array' });
    }

    const decisions: DispatchDecisionInput[] = [];
    for (const raw of body.decisions) {
      const d = raw as { claimId?: unknown; decision?: unknown; notes?: unknown };
      if (typeof d.claimId !== 'string' || !d.claimId.trim()) {
        return res.status(400).json({ success: false, error: 'Each decision requires a claimId' });
      }
      if (d.decision !== 'APPROVED' && d.decision !== 'SKIPPED') {
        return res.status(400).json({ success: false, error: 'decision must be APPROVED or SKIPPED' });
      }
      decisions.push({
        claimId: d.claimId,
        decision: d.decision,
        notes: typeof d.notes === 'string' ? d.notes.trim().slice(0, 500) || undefined : undefined,
      });
    }

    const decidedByUserId = authUserId(req.auth ?? req.practiceAuth);
    if (!decidedByUserId) {
      // Never allow an approval to be logged without an identifiable human —
      // that's the whole point of the audit trail this endpoint exists to produce.
      return res.status(401).json({ success: false, error: 'Session has no identifiable user for the audit trail' });
    }

    const result = await decideDispatchApprovalBatch(prisma, {
      practiceId,
      decidedByUserId,
      decisions,
      req,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[POST /dispatch-approvals/decide]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
