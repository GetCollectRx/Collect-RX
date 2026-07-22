import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authUserId } from '../accessControl/types.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { runWithPracticeRls } from '../db/rlsContext.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
  requirePracticeContext,
} from '../middleware/requirePracticeSession.js';
import {
  checkTriageCredentialHealth,
  getTriageCredentialStatus,
  saveTriageCredential,
} from '../triage/triageCredentialService.js';

const MAX_CREDENTIAL_LENGTH = 4096;

function ownerPracticeId(req: Request, res: Response): string | null {
  const requestedPracticeId = req.params.practiceId;
  if (queryPracticeConflictsSession(req, requestedPracticeId)) {
    res.status(403).json({ success: false, error: 'practiceId does not match session' });
    return null;
  }
  const auth = req.auth ?? req.practiceAuth;
  if (auth?.role !== 'practice_owner') {
    res.status(403).json({ success: false, error: 'This action requires practice owner access' });
    return null;
  }
  return practiceIdFromSession(req);
}

function auditContext(req: Request) {
  const correlationHeader = req.headers['x-correlation-id'];
  return {
    actor: authUserId(req.auth ?? req.practiceAuth) ?? undefined,
    correlationId: typeof correlationHeader === 'string' ? correlationHeader : undefined,
  };
}

export function createTriageCredentialRouter(): Router {
  const router = Router();
  router.use(authenticate);
  router.use(requirePracticeContext);

  router.get('/:practiceId/triage-credential', async (req: Request, res: Response) => {
    try {
      const practiceId = ownerPracticeId(req, res);
      if (!practiceId) return;
      const data = await runWithPracticeRls(practiceId, () =>
        getTriageCredentialStatus(prisma, { practiceId, ...auditContext(req) }),
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.put('/:practiceId/triage-credential', async (req: Request, res: Response) => {
    try {
      const practiceId = ownerPracticeId(req, res);
      if (!practiceId) return;
      const credential = (req.body as { credential?: unknown }).credential;
      if (typeof credential !== 'string' || !credential.trim() || credential.length > MAX_CREDENTIAL_LENGTH) {
        return res.status(422).json({ success: false, error: 'credential must be a non-empty value of 4096 characters or fewer' });
      }
      await runWithPracticeRls(practiceId, () =>
        saveTriageCredential(prisma, { practiceId, credential, ...auditContext(req) }),
      );
      const data = await runWithPracticeRls(practiceId, () =>
        getTriageCredentialStatus(prisma, { practiceId, ...auditContext(req) }),
      );
      void appendAuditLog(prisma, {
        practiceId,
        action: 'triage.credential.enrolled',
        subjectType: 'TriageCredential',
        details: {},
        req,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.post('/:practiceId/triage-credential/test-connection', async (req: Request, res: Response) => {
    try {
      const practiceId = ownerPracticeId(req, res);
      if (!practiceId) return;
      const data = await runWithPracticeRls(practiceId, () =>
        checkTriageCredentialHealth(prisma, { practiceId, ...auditContext(req) }),
      );
      void appendAuditLog(prisma, {
        practiceId,
        action: 'triage.credential.test_connection',
        subjectType: 'TriageCredential',
        details: { enrolled: data.enrolled, status: data.lastHealthCheckStatus },
        req,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  return router;
}
