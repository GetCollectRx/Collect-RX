import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import { practiceIdFromSession, queryPracticeConflictsSession } from '../middleware/requirePracticeSession';
import { parseSimpleCsv } from '../csv/parseSimple';
import { runPmsImportPipeline, type PmsSource } from '../pms/pmsImportPipeline.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const router = Router();
router.use(authenticate);

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
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const run = await prisma.pmsImportRun.findFirst({
      where: { id: req.params.id, practiceId },
    });
    if (!run) return res.status(404).json({ success: false, error: 'Import run not found' });
    return res.json({ success: true, data: run });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/import/:pmsSource', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const pmsSource = req.params.pmsSource as PmsSource;
    if (pmsSource !== 'dentrix' && pmsSource !== 'abeldent') {
      return res.status(400).json({ success: false, error: 'pmsSource must be dentrix or abeldent' });
    }

    const practiceId = practiceIdFromSession(req);
    let rows: Record<string, unknown>[] = [];

    if (req.file?.buffer) {
      const text = req.file.buffer.toString('utf8');
      rows = parseSimpleCsv(text) as Record<string, unknown>[];
    } else if (Array.isArray(req.body?.records)) {
      rows = req.body.records;
    } else if (Array.isArray(req.body)) {
      rows = req.body;
    } else {
      return res.status(400).json({ success: false, error: 'CSV file or JSON records required' });
    }

    const sourceBalanceTotal = req.body?.sourceBalanceTotal
      ? Number(req.body.sourceBalanceTotal)
      : undefined;

    const result = await runPmsImportPipeline(prisma, {
      practiceId,
      pmsSource,
      rows,
      sourceRecordCount: rows.length,
      sourceBalanceTotal,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[POST /admin/sync/import]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
