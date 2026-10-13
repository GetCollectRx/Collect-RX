import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authUserId } from '../accessControl/types.js';
import { authenticate } from '../middleware/authenticate.js';
import { practiceIdFromSession, requirePracticeContext } from '../middleware/requirePracticeSession.js';
import { requireUserRoles } from '../middleware/requireUserRole.js';
import {
  ConsentAttestationError,
  createConsentAttestation,
  getConsentStatus,
  grantAgentPermission,
  revokeAgentPermission,
  revokeConsentAttestation,
} from '../compliance/consentAttestation.js';

const ERROR_STATUS: Record<ConsentAttestationError['code'], number> = {
  INVALID_SIGNER: 400,
  STALE_TEXT_VERSION: 409,
  ALREADY_ATTESTED: 409,
  NOT_FOUND: 404,
};

function bodyString(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) return '';
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ConsentAttestationError) {
    res.status(ERROR_STATUS[error.code]).json({ success: false, error: error.message, code: error.code });
    return;
  }
  res.status(500).json({ success: false, error: 'Consent attestation request failed' });
}

/**
 * Practice consent attestation and agent permission API (policy research
 * HP#1, HP#9). Reads are open to any authenticated user of the practice.
 * Writes are practice owner only: the attestation is a practice-level
 * representation and must not be recorded by front desk or auditors.
 */
export function createConsentAttestationRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(authenticate);
  router.use(requirePracticeContext);

  router.get('/status', async (req: Request, res: Response) => {
    try {
      const status = await getConsentStatus(prisma, practiceIdFromSession(req));
      res.json({ success: true, data: status });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/', requireUserRoles('practice_owner'), async (req: Request, res: Response) => {
    const userId = authUserId(req.auth ?? req.practiceAuth) ?? undefined;
    try {
      const created = await createConsentAttestation(prisma, {
        practiceId: practiceIdFromSession(req),
        textVersion: bodyString(req.body, 'textVersion'),
        signerName: bodyString(req.body, 'signerName'),
        signerRole: bodyString(req.body, 'signerRole'),
        userId,
        req,
      });
      res.status(201).json({
        success: true,
        data: {
          id: created.id,
          textVersion: created.textVersion,
          attestedAt: created.attestedAt,
        },
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/revoke', requireUserRoles('practice_owner'), async (req: Request, res: Response) => {
    const userId = authUserId(req.auth ?? req.practiceAuth) ?? undefined;
    try {
      await revokeConsentAttestation(prisma, {
        practiceId: practiceIdFromSession(req),
        userId,
        reason: bodyString(req.body, 'reason'),
        req,
      });
      res.json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/agent-permission', requireUserRoles('practice_owner'), async (req: Request, res: Response) => {
    const userId = authUserId(req.auth ?? req.practiceAuth) ?? undefined;
    try {
      await grantAgentPermission(prisma, { practiceId: practiceIdFromSession(req), userId, req });
      res.json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post(
    '/agent-permission/revoke',
    requireUserRoles('practice_owner'),
    async (req: Request, res: Response) => {
      const userId = authUserId(req.auth ?? req.practiceAuth) ?? undefined;
      try {
        await revokeAgentPermission(prisma, { practiceId: practiceIdFromSession(req), userId, req });
        res.json({ success: true });
      } catch (error) {
        sendError(res, error);
      }
    },
  );

  return router;
}
