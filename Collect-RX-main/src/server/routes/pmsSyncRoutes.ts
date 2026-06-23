import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { prisma } from '../../lib/prisma';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../middleware/requirePracticeSession';
import { useOwnerPracticeApi } from '../middleware/ownerPracticeApi.js';
import { parseSimpleCsv } from '../csv/parseSimple';
import { runPmsImportPipeline } from '../pms/pmsImportPipeline.js';
import { normalizePmsVendorId } from '../pms/pmsRegistry.js';
import { resolvePmsImport } from '../pms/practicePmsContext.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { validateCsvUploadFile } from '../validation/csvUpload.js';
import { pmsImportBodySchema, formatZodError } from '../validation/zodSchemas.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
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
    console.error('[GET /admin/sync/runs]', err);
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

router.post('/import/:pmsVendor', upload.single('file'), async (req: Request, res: Response) => {
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

    if (req.file?.buffer) {
      const uploadCheck = validateCsvUploadFile(req.file, { maxBytes: 12 * 1024 * 1024 });
      if (!uploadCheck.ok) {
        return res.status(uploadCheck.status).json({ success: false, error: uploadCheck.error });
      }
      const text = req.file.buffer.toString('utf8');
      rows = parseSimpleCsv(text) as Record<string, unknown>[];
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
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[POST /admin/sync/import]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
