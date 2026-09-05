import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import type { PrismaClient } from '@prisma/client';
import {
  extractProspectIdFromHeaders,
  findProspectByEmail,
} from '../marketing/prospectEngagement.js';
import { processInboundReply } from '../marketing/replyIntelligence.js';
import { logger } from '../observability/logger.js';

const upload = multer();

function parseRawHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }
  return out;
}

function extractEmailFromFromField(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match?.[1] || from).trim().toLowerCase();
}

export function createSendgridInboundRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post('/', upload.none(), async (req: Request, res: Response) => {
    const body = req.body as Record<string, string>;
    const from = body.from || '';
    const text = body.text || body.html || '';
    const headersRaw = body.headers || '';
    const headerMap = parseRawHeaders(headersRaw);
    const fromEmail = extractEmailFromFromField(from);

    if (!text.trim() && !fromEmail) {
      return res.status(400).send('missing content');
    }

    const prospectId = extractProspectIdFromHeaders(headerMap);
    let prospect;
    try {
      prospect = prospectId
        ? await prisma.prospect.findUnique({ where: { id: prospectId } })
        : null;
      if (!prospect && fromEmail) {
        prospect = await findProspectByEmail(prisma, fromEmail);
      }
    } catch (err) {
      // A malformed prospectId (e.g. not a valid UUID) throws a Prisma
      // validation error synchronously inside this await — uncaught, that's
      // an unhandled rejection that crashes the whole process under this
      // app's `process.on('unhandledRejection')` handler, not just this request.
      logger.error('[sendgrid-inbound] prospect lookup failed', { error: err });
      return res.status(200).send('ok');
    }

    if (!prospect) {
      logger.warn('[sendgrid-inbound] no matching prospect for', { detail: fromEmail });
      return res.status(200).send('ok');
    }

    try {
      await processInboundReply(prisma, prospect, text, fromEmail);
    } catch (err) {
      logger.error('[sendgrid-inbound]', { error: err });
    }

    return res.status(200).send('ok');
  });

  return router;
}
