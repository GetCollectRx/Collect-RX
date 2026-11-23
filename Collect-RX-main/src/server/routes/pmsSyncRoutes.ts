import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { prisma } from '../../lib/prisma';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../middleware/requirePracticeSession';
import { useOwnerPracticeApi } from '../middleware/ownerPracticeApi.js';
import { parseSimpleCsv, readCsvHeaders } from '../csv/parseSimple';
import { agingReportTemplateHeader, checkAgingReport, describeAgingReportSpec } from '../csv/agingReportSpec.js';
import { sendPracticeNotification } from '../services/practiceNotificationService.js';
import { runPmsImportPipeline, type ExportScope } from '../pms/pmsImportPipeline.js';
import { normalizePmsVendorId } from '../pms/pmsRegistry.js';
import { resolvePmsImport } from '../pms/practicePmsContext.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { validateCsvUploadFile } from '../validation/csvUpload.js';
import { pmsImportBodySchema, formatZodError } from '../validation/zodSchemas.js';
import { blockAuditorWrites } from '../middleware/requireUserRole.js';
import { preserveRlsAcrossMiddleware } from '../db/rlsContext.js';
import { logger } from '../observability/logger.js';

// Configure multer with enhanced security limits
// 100MB max file size as per security audit requirements
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
  fileFilter: (_req, file, cb) => {
    // Only allow CSV files
    if (!file.originalname.endsWith('.csv')) {
      return cb(new Error('Only .csv files allowed'));
    }
    cb(null, true);
  },
});

const router = Router();
useOwnerPracticeApi(router);

router.get('/runs', async (req: Request, res: Response) => {
  try {
    const qP = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qP)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const limit = Math.min(50, parseInt(String(req.query.limit ?? '20'), 10) || 20);

    const runs = await prisma.pmsImportRun.findMany({
      where: { practiceId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    return res.json({ success: true, data: runs });
  } catch (err) {
    logger.error('[GET /admin/sync/runs]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const run = await prisma.pmsImportRun.findFirst({
      where: { id: req.params.id, practiceId },
    });
    if (!run) return res.status(404).json({ success: false, error: 'Import run not found' });
    const errorLog = run.errorLog as {
      validationMessages?: string[];
      rowErrors?: { row?: number; message?: string }[];
    } | null;
    return res.json({
      success: true,
      data: {
        ...run,
        validationMessages: errorLog?.validationMessages ?? [],
        rowErrors: errorLog?.rowErrors ?? [],
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/aging-report-spec', (_req: Request, res: Response) => {
  res.json({ success: true, data: { fields: describeAgingReportSpec(), templateHeader: agingReportTemplateHeader() } });
});

/** Dry run: tell staff whether a file would be accepted, without importing anything. */
router.post('/import-check', blockAuditorWrites, preserveRlsAcrossMiddleware(upload.single('file')), async (req: Request, res: Response) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ success: false, error: 'Choose a CSV file to check.' });
    const uploadCheck = validateCsvUploadFile(req.file, { maxBytes: 100 * 1024 * 1024 });
    if (!uploadCheck.ok) return res.status(uploadCheck.status).json({ success: false, error: uploadCheck.error });
    const text = req.file.buffer.toString('utf8');
    let rows: Record<string, string>[];
    try {
      rows = parseSimpleCsv(text);
    } catch (parseErr) {
      return res.status(400).json({ success: false, error: `CSV parsing failed: ${(parseErr as Error).message}` });
    }
    const check = checkAgingReport(readCsvHeaders(text), rows);
    return res.json({ success: true, data: { accepted: check.ok, rowCount: check.rowCount, problems: check.problems } });
  } catch (err) {
    logger.error('[POST /admin/sync/import-check]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/import/:pmsVendor', blockAuditorWrites, preserveRlsAcrossMiddleware(upload.single('file')), async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const slug = req.params.pmsVendor;
    const vendorParam = normalizePmsVendorId(slug);
    if (!vendorParam && slug !== 'auto') {
      return res.status(400).json({
        success: false,
        error: `Unknown PMS vendor "${slug}". Use a catalog id or "auto" for practice default.`,
      });
    }
    let rows: Record<string, unknown>[] = [];
    let sourceBalanceTotal: number | undefined;
    let exportScope: ExportScope = 'partial';
    let fileText: string | null = null;

    if (req.file?.buffer) {
      const uploadCheck = validateCsvUploadFile(req.file, { maxBytes: 100 * 1024 * 1024 });
      if (!uploadCheck.ok) {
        return res.status(uploadCheck.status).json({ success: false, error: uploadCheck.error });
      }
      const multipartScope = (req.body as { exportScope?: unknown } | undefined)?.exportScope;
      if (multipartScope === 'full' || multipartScope === 'partial') exportScope = multipartScope;
      const text = req.file.buffer.toString('utf8');
      fileText = text;
      try {
        rows = parseSimpleCsv(text) as Record<string, unknown>[];
      } catch (parseErr) {
        console.warn('[CSV Parse Error]', { error: parseErr, fileName: req.file.originalname });
        return res.status(400).json({
          success: false,
          error: `CSV parsing failed: ${(parseErr as Error).message}`,
        });
      }
    } else {
      const bodyParsed = pmsImportBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return res.status(400).json({ success: false, error: formatZodError(bodyParsed.error) });
      }
      if (Array.isArray(bodyParsed.data.records)) {
        rows = bodyParsed.data.records as Record<string, unknown>[];
      } else if (Array.isArray(req.body)) {
        rows = req.body as Record<string, unknown>[];
      } else {
        return res.status(400).json({ success: false, error: 'CSV file or JSON records required' });
      }
      sourceBalanceTotal = bodyParsed.data.sourceBalanceTotal;
      exportScope = bodyParsed.data.exportScope ?? 'partial';
    }

    // A file upload must carry the columns the importer needs. Refuse it whole, with a reason per problem,
    // before anything is imported. Row-level problems are still held back per claim by the pipeline.
    if (fileText !== null) {
      const check = checkAgingReport(readCsvHeaders(fileText), rows as Record<string, string>[]);
      if (!check.ok) {
        void sendPracticeNotification(prisma, {
          practiceId,
          type: 'PMS_IMPORT_FAILED',
          subject: 'Aging report not accepted',
          message: `${check.problems.length} problem(s) with the uploaded aging report, so nothing was imported: ${check.problems.map((p) => p.message).join(' ')}`,
          severity: 'warning',
        }).catch((notifyErr: unknown) => logger.error('[pms import] rejection notification failed', { error: notifyErr }));
        return res.status(422).json({
          success: false,
          code: 'AGING_REPORT_REJECTED',
          error: 'This file was not accepted. Nothing was imported.',
          problems: check.problems,
          spec: describeAgingReportSpec(),
        });
      }
    }

    const resolved =
      slug === 'auto'
        ? await resolvePmsImport(prisma, practiceId, null)
        : { vendorId: vendorParam! };

    const result = await runPmsImportPipeline(prisma, {
      practiceId,
      pmsSource: resolved.vendorId,
      rows,
      sourceRecordCount: rows.length,
      sourceBalanceTotal,
      exportScope,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('[POST /admin/sync/import]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/import/eob', blockAuditorWrites, preserveRlsAcrossMiddleware(upload.single('file')), async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'CSV file required' });
    }
    const uploadCheck = validateCsvUploadFile(req.file, { maxBytes: 100 * 1024 * 1024 });
    if (!uploadCheck.ok) {
      return res.status(uploadCheck.status).json({ success: false, error: uploadCheck.error });
    }
    const text = req.file.buffer.toString('utf8');
    let rows: Record<string, unknown>[];
    try {
      rows = parseSimpleCsv(text) as Record<string, unknown>[];
    } catch (parseErr) {
      console.warn('[CSV Parse Error (EOB)]', { error: parseErr, fileName: req.file.originalname });
      return res.status(400).json({
        success: false,
        error: `CSV parsing failed: ${(parseErr as Error).message}`,
      });
    }
    const { importEobRowsToPrisma } = await import('../reconciliation/eobImport.js');
    const result = await importEobRowsToPrisma(prisma, practiceId, rows);
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error('[POST /admin/sync/import/eob]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
