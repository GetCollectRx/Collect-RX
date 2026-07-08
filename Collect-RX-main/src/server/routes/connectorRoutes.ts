import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticateConnector } from '../middleware/authenticateConnector.js';
import { strictLimiter } from '../middleware/rateLimiter.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { runPmsImportPipeline } from '../pms/pmsImportPipeline.js';
import { recordConnectorHeartbeat } from '../services/desktopConnectorService.js';
import { appendAuditLog } from '../audit/auditLog.js';

const router = Router();

router.use(authenticateConnector);

router.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    const auth = req.connectorAuth!;
    const body = req.body as {
      status?: string;
      message?: string;
      imported?: number;
      version?: string;
      hostname?: string;
      platform?: string;
    };
    await recordConnectorHeartbeat(auth.agentId, auth.practiceId, {
      status: body.status,
      message: body.message,
      imported: body.imported,
      agentVersion: body.version,
      hostname: body.hostname,
      platform: body.platform,
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /connector/heartbeat]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/claims/import', strictLimiter, async (req: Request, res: Response) => {
  try {
    const auth = req.connectorAuth!;
    const body = req.body as { records?: unknown[]; pmsSource?: string; pmsVendor?: string };
    const rows = body.records;
    if (!Array.isArray(rows)) {
      return res.status(400).json({
        success: false,
        error: 'Expected JSON body { records: array, pmsVendor?: string }',
      });
    }
    const result = await runPmsImportPipeline(prisma, {
      practiceId: auth.practiceId,
      pmsSource: body.pmsVendor ?? body.pmsSource ?? 'abeldent',
      rows: rows as Record<string, unknown>[],
      sourceRecordCount: rows.length,
    });
    await recordConnectorHeartbeat(auth.agentId, auth.practiceId, {
      status: result.failed > 0 ? 'error' : 'ok',
      message: `Imported ${result.imported}, failed ${result.failed}`,
      imported: result.imported,
    });
    void appendAuditLog(prisma, {
      practiceId: auth.practiceId,
      action: 'connector.claims.import',
      subjectType: 'DesktopConnectorAgent',
      subjectId: auth.agentId,
      details: {
        imported: result.imported,
        failed: result.failed,
        runId: result.runId,
        pmsVendor: result.pmsVendor,
      },
    });
    return res.json({
      success: true,
      pmsVendor: result.pmsVendor,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      errors: result.errors,
      runId: result.runId,
    });
  } catch (err) {
    console.error('[POST /connector/claims/import]', err);
    const auth = req.connectorAuth;
    if (auth) {
      await recordConnectorHeartbeat(auth.agentId, auth.practiceId, {
        status: 'error',
        message: apiErrorMessageForResponse(err),
      }).catch(() => undefined);
    }
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export function createConnectorRouter(): Router {
  return router;
}
