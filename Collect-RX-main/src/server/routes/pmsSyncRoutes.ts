import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { prisma } from '../../lib/prisma';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../middleware/requirePracticeSession';
import { useOwnerPracticeApi } from '../middleware/ownerPracticeApi.js';
import { parseSimpleCsv } from '../csv/parseSimple';
import {
  AbsentClaimsChangedError,
  previewFullExportAbsence,
  runPmsImportPipeline,
  type ExportScope,
} from '../pms/pmsImportPipeline.js';
import { normalizePmsVendorId } from '../pms/pmsRegistry.js';
import { parsePayerTypeInput } from '../pms/payerTypeInput.js';
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

/**
 * What a full export would stop calling, before anything is imported. The import
 * wizard shows this count and sends it back as confirmedMissingCount, so the
 * number staff confirm is the number that is applied. Changes nothing.
 */
router.post('/import/:pmsVendor/absence-preview', preserveRlsAcrossMiddleware(upload.single('file')), async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const slug = req.params.pmsVendor;
    const vendorParam = normalizePmsVendorId(slug);
    if (!vendorParam && slug !== 'auto') {
      return res.status(400).json({ success: false, error: `Unknown PMS vendor "${slug}".` });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'CSV file required' });
    }
    const uploadCheck = validateCsvUploadFile(req.file, { maxBytes: 100 * 1024 * 1024 });
    if (!uploadCheck.ok) {
      return res.status(uploadCheck.status).json({ success: false, error: uploadCheck.error });
    }
    let rows: Record<string, unknown>[];
    try {
      rows = parseSimpleCsv(req.file.buffer.toString('utf8')) as Record<string, unknown>[];
    } catch (parseErr) {
      return res.status(400).json({ success: false, error: `CSV parsing failed: ${(parseErr as Error).message}` });
    }
    let preview;
    try {
      preview = await previewFullExportAbsence(prisma, {
        practiceId,
        pmsSource: slug === 'auto' ? null : vendorParam,
        rows,
      });
    } catch (rowErr) {
      // A row the import itself would reject (no claim number, and so on): the import reports it properly.
      return res.status(400).json({ success: false, error: (rowErr as Error).message });
    }
    return res.json({ success: true, data: preview });
  } catch (err) {
    logger.error('[POST /admin/sync/import/:pmsVendor/absence-preview]', { error: err });
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
    let declaredPayerType: unknown;
    let confirmedMissingCount: number | undefined;

    if (req.file?.buffer) {
      const uploadCheck = validateCsvUploadFile(req.file, { maxBytes: 100 * 1024 * 1024 });
      if (!uploadCheck.ok) {
        return res.status(uploadCheck.status).json({ success: false, error: uploadCheck.error });
      }
      const multipartScope = (req.body as { exportScope?: unknown } | undefined)?.exportScope;
      if (multipartScope === 'full' || multipartScope === 'partial') exportScope = multipartScope;
      declaredPayerType = (req.body as { defaultPayerType?: unknown } | undefined)?.defaultPayerType;
      const multipartConfirmed = (req.body as { confirmedMissingCount?: unknown } | undefined)?.confirmedMissingCount;
      if (multipartConfirmed !== undefined && multipartConfirmed !== '') {
        const n = Number(multipartConfirmed);
        if (!Number.isInteger(n) || n < 0) {
          return res.status(400).json({ success: false, error: 'confirmedMissingCount must be a whole number' });
        }
        confirmedMissingCount = n;
      }
      const text = req.file.buffer.toString('utf8');
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
      declaredPayerType = bodyParsed.data.defaultPayerType;
      confirmedMissingCount = bodyParsed.data.confirmedMissingCount;
    }

    const payerTypeParse = parsePayerTypeInput(declaredPayerType);
    if (!payerTypeParse.ok) {
      return res.status(400).json({ success: false, error: payerTypeParse.error });
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
      confirmedMissingCount,
      defaultPayerType: payerTypeParse.value ?? undefined,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof AbsentClaimsChangedError) {
      return res.status(409).json({ success: false, error: err.message, code: 'ABSENT_CLAIMS_CHANGED' });
    }
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
