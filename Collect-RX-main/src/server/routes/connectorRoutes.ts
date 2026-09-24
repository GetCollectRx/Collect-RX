import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { prisma } from '../../lib/prisma.js';
import { authenticateConnector } from '../middleware/authenticateConnector.js';
import { strictLimiter } from '../middleware/rateLimiter.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { runPmsImportPipeline } from '../pms/pmsImportPipeline.js';
import { normalizePmsVendorId } from '../pms/pmsRegistry.js';
import { resolvePmsImport } from '../pms/practicePmsContext.js';
import { parseSimpleCsv, computeCsvHash } from '../csv/parseSimple.js';
import { validateCsvUploadFile } from '../validation/csvUpload.js';
import { recordConnectorHeartbeat } from '../services/desktopConnectorService.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { dispatchOpsAlert } from '../observability/opsAlerts.js';
import { logger } from '../observability/logger.js';

const router = Router();

// Same limits as the session-authenticated CSV route (pmsSyncRoutes.ts) — memory storage,
// 100MB cap enforced twice (multer + validateCsvUploadFile, matching that route's pattern).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.csv') && !file.originalname.toLowerCase().endsWith('.txt')) {
      return cb(new Error('Only .csv or .txt files allowed'));
    }
    cb(null, true);
  },
});

/**
 * multer's fileFilter/size-limit errors call next(err) *before* the route handler's own
 * try/catch runs, which would otherwise fall through to the server's generic error
 * handler as an opaque 500. The folder-watcher relies on the status code to decide
 * whether an upload failure is retryable (5xx/network) or permanent (4xx) — see
 * folderWatchSync.cjs's `err.transient` check — so a bad file type must come back as
 * a real 400, not a 500 the watcher would keep retrying forever.
 */
function uploadSingleFile(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Invalid file upload';
      res.status(400).json({ success: false, error: message });
      return;
    }
    next();
  });
}

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
    logger.error('[POST /connector/heartbeat]', { error: err });
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
    if (result.failed > 0) {
      void dispatchOpsAlert({
        alertId: 'connector_sync_failed',
        detail: `Practice ${auth.practiceId}: import partial — ${result.failed} failed, ${result.imported} imported`,
        source: `connector:${auth.agentId}`,
      });
    }
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
    logger.error('[POST /connector/claims/import]', { error: err });
    const auth = req.connectorAuth;
    if (auth) {
      await recordConnectorHeartbeat(auth.agentId, auth.practiceId, {
        status: 'error',
        message: apiErrorMessageForResponse(err),
      }).catch(() => undefined);
      void dispatchOpsAlert({
        alertId: 'connector_sync_failed',
        detail: `Practice ${auth.practiceId}: ${apiErrorMessageForResponse(err)}`,
        source: `connector:${auth.agentId}`,
      });
    }
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

/**
 * File-upload counterpart to /claims/import, for the local folder-watcher agent
 * (desktop/services/folderWatchSync.cjs). Same connector-token auth as every other
 * route in this router; parsing/normalization/upsert/validation stay server-side and
 * identical to the session-authenticated path in pmsSyncRoutes.ts — the watcher only
 * ever moves bytes, it never re-implements CSV parsing.
 */
router.post('/claims/import-file', strictLimiter, uploadSingleFile, async (req: Request, res: Response) => {
  try {
    const auth = req.connectorAuth!;
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'CSV file required (field name: file)' });
    }
    const uploadCheck = validateCsvUploadFile(req.file, { maxBytes: 100 * 1024 * 1024 });
    if (!uploadCheck.ok) {
      return res.status(uploadCheck.status).json({ success: false, error: uploadCheck.error });
    }

    const slug = typeof req.body?.pmsVendor === 'string' ? req.body.pmsVendor : 'auto';
    const vendorParam = normalizePmsVendorId(slug);
    if (!vendorParam && slug !== 'auto') {
      return res.status(400).json({
        success: false,
        error: `Unknown PMS vendor "${slug}". Use a catalog id or "auto" for practice default.`,
      });
    }

    const text = req.file.buffer.toString('utf8');
    const contentHash = computeCsvHash(text);
    let rows: Record<string, unknown>[];
    try {
      rows = parseSimpleCsv(text) as Record<string, unknown>[];
    } catch (parseErr) {
      logger.warn('[POST /connector/claims/import-file] CSV parse error', {
        practiceId: auth.practiceId,
        fileName: req.file.originalname,
        error: (parseErr as Error).message,
      });
      return res.status(400).json({
        success: false,
        error: `CSV parsing failed: ${(parseErr as Error).message}`,
      });
    }

    const resolved =
      slug === 'auto'
        ? await resolvePmsImport(prisma, auth.practiceId, null)
        : { vendorId: vendorParam! };

    const sourceRecordCount = Number(req.body?.sourceRecordCount);
    const sourceBalanceTotal = Number(req.body?.sourceBalanceTotal);

    const result = await runPmsImportPipeline(prisma, {
      practiceId: auth.practiceId,
      pmsSource: resolved.vendorId,
      rows,
      sourceRecordCount: Number.isFinite(sourceRecordCount) ? sourceRecordCount : rows.length,
      sourceBalanceTotal: Number.isFinite(sourceBalanceTotal) ? sourceBalanceTotal : undefined,
    });

    await recordConnectorHeartbeat(auth.agentId, auth.practiceId, {
      status: result.failed > 0 ? 'error' : 'ok',
      message: `File import: ${result.imported} imported, ${result.failed} failed (${req.file.originalname})`,
      imported: result.imported,
    });
    void appendAuditLog(prisma, {
      practiceId: auth.practiceId,
      action: 'connector.claims.import_file',
      subjectType: 'DesktopConnectorAgent',
      subjectId: auth.agentId,
      details: {
        fileName: req.file.originalname,
        contentHash,
        imported: result.imported,
        failed: result.failed,
        skipped: result.skipped,
        runId: result.runId,
        pmsVendor: result.pmsVendor,
        validationPassed: result.validationPassed,
      },
    });
    if (result.failed > 0) {
      void dispatchOpsAlert({
        alertId: 'connector_sync_failed',
        detail: `Practice ${auth.practiceId}: file import partial — ${result.failed} failed, ${result.imported} imported (${req.file.originalname})`,
        source: `connector:${auth.agentId}`,
      });
    }

    return res.json({
      success: true,
      pmsVendor: result.pmsVendor,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      errors: result.errors,
      runId: result.runId,
      validationPassed: result.validationPassed,
      contentHash,
    });
  } catch (err) {
    logger.error('[POST /connector/claims/import-file]', { error: err });
    const auth = req.connectorAuth;
    if (auth) {
      await recordConnectorHeartbeat(auth.agentId, auth.practiceId, {
        status: 'error',
        message: apiErrorMessageForResponse(err),
      }).catch(() => undefined);
      void dispatchOpsAlert({
        alertId: 'connector_sync_failed',
        detail: `Practice ${auth.practiceId}: ${apiErrorMessageForResponse(err)}`,
        source: `connector:${auth.agentId}`,
      });
    }
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/writeback-pending', async (req: Request, res: Response) => {
  try {
    const auth = req.connectorAuth!;
    const take = Math.min(50, Math.max(1, Number(req.query.limit) || 25));
    const rows = await prisma.pmsWritebackLog.findMany({
      where: { practiceId: auth.practiceId, processedAt: null, processError: null },
      orderBy: { createdAt: 'asc' },
      take,
    });
    return res.json({ success: true, entries: rows });
  } catch (err) {
    logger.error('[GET /connector/writeback-pending]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/writeback-ack', strictLimiter, async (req: Request, res: Response) => {
  try {
    const auth = req.connectorAuth!;
    const b = (req.body || {}) as Record<string, unknown>;
    const id = String(b.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    const ok = Boolean(b.ok);
    const errMsg = typeof b.error === 'string' ? b.error.slice(0, 500) : null;
    const existing = await prisma.pmsWritebackLog.findFirst({
      where: { id, practiceId: auth.practiceId },
    });
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });
    await prisma.pmsWritebackLog.update({
      where: { id },
      data: ok
        ? { processedAt: new Date(), processError: null }
        : { processError: errMsg || 'unknown error' },
    });
    void appendAuditLog(prisma, {
      practiceId: auth.practiceId,
      action: ok ? 'connector.writeback.ack' : 'connector.writeback.error',
      subjectType: 'PmsWritebackLog',
      subjectId: id,
      details: { ok, error: errMsg },
    });
    return res.json({ success: true });
  } catch (err) {
    logger.error('[POST /connector/writeback-ack]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export function createConnectorRouter(): Router {
  return router;
}
